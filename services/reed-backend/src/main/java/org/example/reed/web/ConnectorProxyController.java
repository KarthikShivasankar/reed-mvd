/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import jakarta.servlet.http.HttpServletRequest;
import org.example.reed.edc.ConnectorClient;
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

    public ConnectorProxyController(ConnectorClient client, ParticipantRepository participants) {
        this.client = client;
        this.participants = participants;
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
        return relay(client.exchange(name, p.managementUrl, HttpMethod.valueOf(request.getMethod()), path, body));
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
