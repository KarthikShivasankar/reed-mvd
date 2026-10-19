/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.edc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
    private final Map<String, String> keys;
    private final Map<String, String> callbackKeys;
    private final String federatedCatalogUrl;
    private final String callbackBase;
    private final ObjectMapper mapper;

    public ConnectorClient(@Value("${reed.connectors.keys:}") String keySpec,
                           @Value("${reed.connectors.callback-keys:}") String callbackKeySpec,
                           @Value("${reed.connectors.federated-catalog-url}") String federatedCatalogUrl,
                           @Value("${reed.internal-url}") String callbackBase, ObjectMapper mapper) {
        this.keys = parse(keySpec);
        this.callbackKeys = parse(callbackKeySpec);
        this.federatedCatalogUrl = federatedCatalogUrl;
        this.callbackBase = callbackBase;
        this.mapper = mapper;
    }

    /** "a=1,b=2" -> {a: 1, b: 2} */
    public static Map<String, String> parse(String spec) {
        var out = new HashMap<String, String>();
        for (var pair : spec.split(",")) {
            var kv = pair.split("=", 2);
            if (kv.length == 2) {
                out.put(kv[0].trim(), kv[1].trim());
            }
        }
        return out;
    }

    /**
     * Replaces any caller-supplied callback addresses with the server's own: for transfers, the
     * {@code transfer.process.started} callback that delivers the EDR to the REED backend, authenticated
     * with the connector's low-privilege callback key from its Vault folder; for negotiations, none.
     */
    public String withServerCallbacks(String connector, String body, boolean edrCallback) {
        try {
            var json = (ObjectNode) mapper.readTree(body);
            json.remove("callbackAddresses");
            json.remove("https://w3id.org/edc/v0.0.1/ns/callbackAddresses");
            if (edrCallback) {
                var cb = json.putArray("callbackAddresses").addObject();
                cb.put("@type", "CallbackAddress");
                cb.put("uri", callbackBase + "/reed/edc-callbacks/" + connector);
                cb.putArray("events").add("transfer.process.started");
                cb.put("transactional", false);
                // Full IRIs: the management/v2 context does not define these terms, so short names are dropped.
                cb.put("https://w3id.org/edc/v0.0.1/ns/authKey", "X-Api-Key");
                cb.put("https://w3id.org/edc/v0.0.1/ns/authCodeId", connector + "-callback-key");
            }
            return mapper.writeValueAsString(json);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "request body must be a JSON object");
        }
    }

    /** True if {@code key} is the callback key of {@code connectorName} (constant-time compare). */
    public boolean isCallbackKey(String connectorName, String key) {
        var expected = callbackKeys.get(connectorName);
        return expected != null && key != null && java.security.MessageDigest.isEqual(
                expected.getBytes(java.nio.charset.StandardCharsets.UTF_8), key.getBytes(java.nio.charset.StandardCharsets.UTF_8));
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
