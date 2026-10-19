/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import jakarta.servlet.http.HttpServletRequest;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.edc.EdrStore;
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

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Backend-for-frontend for the EDC Management APIs. The dashboard never holds a
 * connector key: it calls {@code /reed/connectors/{name}/...} with its user
 * token, and this controller forwards to that connector only if the user
 * belongs to the organisation running it (or is an admin), adding the key
 * server-side. Only an allowlist of calls is relayed, and callback addresses are always set by the
 * server (callers could otherwise make the connector post a secret to a URL of their choice). The
 * federated catalog is readable by every member.
 */
@RestController
public class ConnectorProxyController {

    private final ConnectorClient client;
    private final ParticipantRepository participants;
    private final EdrStore edrs;

    public ConnectorProxyController(ConnectorClient client, ParticipantRepository participants, EdrStore edrs) {
        this.client = client;
        this.participants = participants;
        this.edrs = edrs;
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
        var method = request.getMethod();
        if (ALLOWED.stream().noneMatch(a -> a.method().equals(method) && a.path().matcher(path).matches())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, method + " " + path + " is not available through the REED relay");
        }
        if ("POST".equals(method) && path.matches("/v4/(transferprocesses|contractnegotiations)/?")) {
            body = client.withServerCallbacks(name, body, path.contains("transferprocesses"));
        }
        return relay(client.exchange(name, p.managementUrl, HttpMethod.valueOf(method), path, body));
    }

    private record Route(String method, Pattern path) {
    }

    /**
     * The Management API calls the dashboard needs - nothing else is relayed (no asset, policy or secret
     * management, which stays with the operator's seeding).
     */
    private static final List<Route> ALLOWED = List.of(
            new Route("POST", Pattern.compile("/v4/catalog/request")),
            new Route("POST", Pattern.compile("/v4/(contractnegotiations|transferprocesses|contractagreements)(/request)?/?")),
            new Route("GET", Pattern.compile("/v4/(contractnegotiations|transferprocesses|contractagreements)/[A-Za-z0-9:_.-]{1,128}")));

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

    @RequestMapping("/reed/federated-catalog/**")
    public ResponseEntity<String> federatedCatalog(@AuthenticationPrincipal Jwt jwt, HttpServletRequest request,
                                                   @RequestBody(required = false) String body) {
        var user = CurrentUser.of(jwt);
        if (!user.isAdmin() && (user.bpn() == null || !participants.existsByBpnAndConsortiumTrue(user.bpn()))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only consortium members may query the federated catalog");
        }
        var path = request.getRequestURI().substring("/reed/federated-catalog".length());
        if (!"POST".equals(request.getMethod()) || !path.matches("/v4/catalogs/request/?")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only catalog queries are relayed to the federated catalog");
        }
        return relay(client.exchange("federated-catalog", client.federatedCatalogUrl(), HttpMethod.POST, path, body));
    }

    private static ResponseEntity<String> relay(ResponseEntity<String> res) {
        return ResponseEntity.status(res.getStatusCode())
                .header("Content-Type", "application/json")
                .body(res.getBody());
    }
}
