/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import com.fasterxml.jackson.databind.JsonNode;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.edc.EdrStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Iterator;
import java.util.Map;

/**
 * Receives EDC callback events from the connectors. A consumer connector posts
 * {@code TransferProcessStarted} here (the relay registers this callback on every transfer it
 * starts), carrying the endpoint data reference for the pull. The connector authenticates with its
 * own Management API key, which it reads from its Vault folder ({@code authCodeId}).
 */
@RestController
public class EdcCallbackController {

    private static final Logger LOG = LoggerFactory.getLogger(EdcCallbackController.class);

    private final ConnectorClient connectors;
    private final EdrStore edrs;

    public EdcCallbackController(ConnectorClient connectors, EdrStore edrs) {
        this.connectors = connectors;
        this.edrs = edrs;
    }

    @PostMapping("/reed/edc-callbacks/{connector}")
    public ResponseEntity<Void> event(@PathVariable String connector,
                                      @RequestHeader(value = "X-Api-Key", required = false) String key,
                                      @RequestBody JsonNode event) {
        if (!connectors.isConnectorKey(connector, key)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        var payload = event.path("payload");
        var tp = payload.path("transferProcessId").asText(null);
        var address = payload.path("dataAddress");
        var endpoint = find(address, "endpoint");
        var authorization = find(address, "authorization");
        if (tp != null && endpoint != null && authorization != null) {
            edrs.put(new EdrStore.Edr(connector, tp, endpoint, authorization, Instant.now()));
        } else {
            LOG.debug("callback {} from {} carried no EDR", event.path("type").asText(), connector);
        }
        return ResponseEntity.noContent().build();
    }

    /** A data address property, whether flat, under "properties", or with the edc namespace prefix. */
    static String find(JsonNode node, String name) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (node.isObject()) {
            for (Iterator<Map.Entry<String, JsonNode>> it = node.fields(); it.hasNext(); ) {
                var e = it.next();
                var k = e.getKey();
                if ((k.equals(name) || k.endsWith("/" + name) || k.endsWith(":" + name)) && e.getValue().isValueNode()) {
                    return e.getValue().asText();
                }
            }
            for (Iterator<JsonNode> it = node.elements(); it.hasNext(); ) {
                var found = find(it.next(), name);
                if (found != null) {
                    return found;
                }
            }
        }
        return null;
    }
}
