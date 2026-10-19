/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import jakarta.servlet.http.HttpServletRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.edc.EdrStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.security.CurrentUser;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * Backend-for-frontend for the EDC Management APIs. The dashboard never holds a
 * connector key: it calls {@code /reed/connectors/{name}/...} with its user
 * token, and this controller forwards to that connector only if the user
 * belongs to the organisation running it (or is an admin), adding the key
 * server-side. The federated catalog is readable by every member.
 */
@RestController
public class ConnectorProxyController {

    private final ConnectorClient client;
    private final ParticipantRepository participants;
    private final EdrStore edrs;
    private final ObjectMapper mapper;
    private final String callbackBase;

    public ConnectorProxyController(ConnectorClient client, ParticipantRepository participants, EdrStore edrs,
                                    ObjectMapper mapper, @Value("${reed.internal-url}") String callbackBase) {
        this.client = client;
        this.participants = participants;
        this.edrs = edrs;
        this.mapper = mapper;
        this.callbackBase = callbackBase;
    }

    @RequestMapping("/reed/connectors/{name}/**")
    public ResponseEntity<String> connector(@AuthenticationPrincipal Jwt jwt, @PathVariable String name,
                                            HttpServletRequest request, @RequestBody(required = false) String body) {
        var user = CurrentUser.of(jwt);
        var p = participants.findByConnectorName(name)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown connector " + name));
        if (!user.isAdmin() && !name.equals(user.participant())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "user " + user.username() + " may only operate its own organisation's connector");
        }
        var path = request.getRequestURI().substring(("/reed/connectors/" + name).length());
        if ("POST".equals(request.getMethod()) && path.matches("/v4/transferprocesses/?")) {
            body = withEdrCallback(name, body);
        }
        return relay(client.exchange(name, p.managementUrl, HttpMethod.valueOf(request.getMethod()), path, body));
    }

    /**
     * The EDR of a transfer started through this relay, as delivered by the consumer connector's
     * {@code transfer.process.started} callback. 404 until the transfer has started.
     */
    @GetMapping("/reed/connectors/{name}/edrs/{transferProcessId}")
    public ResponseEntity<Object> edr(@AuthenticationPrincipal Jwt jwt, @PathVariable String name,
                                      @PathVariable String transferProcessId) {
        var user = CurrentUser.of(jwt);
        if (!user.isAdmin() && !name.equals(user.participant())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "user " + user.username() + " may only operate its own organisation's connector");
        }
        return edrs.get(name, transferProcessId)
                .<ResponseEntity<Object>>map(e -> ResponseEntity.ok(Map.of("endpoint", e.endpoint(), "authorization", e.authorization())))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", "no EDR received yet")));
    }

    /** Adds the callback that delivers the EDR to the REED backend (unless the caller set its own). */
    private String withEdrCallback(String connector, String body) {
        try {
            var json = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(body);
            if (!json.has("callbackAddresses")) {
                var cb = json.putArray("callbackAddresses").addObject();
                cb.put("@type", "CallbackAddress");
                cb.put("uri", callbackBase + "/reed/edc-callbacks/" + connector);
                cb.putArray("events").add("transfer.process.started");
                cb.put("transactional", false);
                // Full IRIs: the management/v2 context does not define these terms, so short names are dropped.
                cb.put("https://w3id.org/edc/v0.0.1/ns/authKey", "X-Api-Key");
                cb.put("https://w3id.org/edc/v0.0.1/ns/authCodeId", connector + "-mgmt-api-key"); // its own key, from its Vault folder
            }
            return mapper.writeValueAsString(json);
        } catch (Exception e) {
            return body; // not JSON: let the connector reject it
        }
    }

    @RequestMapping("/reed/federated-catalog/**")
    public ResponseEntity<String> federatedCatalog(@AuthenticationPrincipal Jwt jwt, HttpServletRequest request,
                                                   @RequestBody(required = false) String body) {
        var user = CurrentUser.of(jwt);
        if (!user.isAdmin() && (user.bpn() == null || !participants.existsByBpnAndConsortiumTrue(user.bpn()))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only consortium members may query the federated catalog");
        }
        var path = request.getRequestURI().substring("/reed/federated-catalog".length());
        return relay(client.exchange("federated-catalog", client.federatedCatalogUrl(),
                HttpMethod.valueOf(request.getMethod()), path, body));
    }

    private static ResponseEntity<String> relay(ResponseEntity<String> res) {
        return ResponseEntity.status(res.getStatusCode())
                .header("Content-Type", "application/json")
                .body(res.getBody());
    }
}
