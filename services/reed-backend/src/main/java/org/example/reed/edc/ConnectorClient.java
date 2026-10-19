/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.edc;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.Map;

/**
 * Calls an EDC connector's Management API on behalf of REED. Each connector's
 * Management API is protected by its own key ({@code REED_MGMT_KEYS}, e.g.
 * {@code nordvind=…,castellum=…}); the keys stay server-side so the browser
 * never holds one.
 */
@Component
public class ConnectorClient {

    private final RestClient http = RestClient.create();
    private final Map<String, String> keys = new HashMap<>();
    private final String federatedCatalogUrl;

    public ConnectorClient(@Value("${reed.connectors.keys:}") String keySpec,
                           @Value("${reed.connectors.federated-catalog-url}") String federatedCatalogUrl) {
        for (var pair : keySpec.split(",")) {
            var kv = pair.split("=", 2);
            if (kv.length == 2) {
                keys.put(kv[0].trim(), kv[1].trim());
            }
        }
        this.federatedCatalogUrl = federatedCatalogUrl;
    }

    public String federatedCatalogUrl() {
        return federatedCatalogUrl;
    }

    /** Forwards a request verbatim and returns the connector's status + body. */
    public ResponseEntity<String> exchange(String connectorName, String managementUrl, HttpMethod method,
                                           String path, String body) {
        var spec = http.method(method).uri(managementUrl + path)
                .header("X-Api-Key", keys.getOrDefault(connectorName, ""));
        if (body != null && !body.isEmpty()) {
            spec = spec.contentType(MediaType.APPLICATION_JSON).body(body);
        }
        try {
            return spec.retrieve().toEntity(String.class);
        } catch (RestClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode()).contentType(MediaType.APPLICATION_JSON)
                    .body(e.getResponseBodyAsString());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "connector " + connectorName + " unreachable: " + e.getMessage(), e);
        }
    }

    /** POST that must succeed; returns the body. */
    public String post(String connectorName, String managementUrl, String path, String body) {
        var res = exchange(connectorName, managementUrl, HttpMethod.POST, path, body);
        if (!res.getStatusCode().is2xxSuccessful()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "connector " + connectorName + " answered " + res.getStatusCode() + " for " + path);
        }
        return res.getBody();
    }

    public String get(String connectorName, String managementUrl, String path) {
        var res = exchange(connectorName, managementUrl, HttpMethod.GET, path, null);
        if (!res.getStatusCode().is2xxSuccessful()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "connector " + connectorName + " answered " + res.getStatusCode() + " for " + path);
        }
        return res.getBody();
    }
}
