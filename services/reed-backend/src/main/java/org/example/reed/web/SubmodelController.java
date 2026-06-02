/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.config.ReedProperties;
import org.example.reed.domain.AssetClass;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.repo.AuditEventRepository;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * The REED <b>submodel service</b>: serves the confidential payload for an
 * asset. This is the endpoint the provider's data-plane proxy pulls from once a
 * consumer presents a valid EDR - i.e. only after a contract is accepted. Every
 * pull is recorded as a {@code PULL} audit event (usage layer).
 */
@RestController
public class SubmodelController {

    private final ReedProperties props;
    private final AuditEventRepository audit;

    public SubmodelController(ReedProperties props, AuditEventRepository audit) {
        this.props = props;
        this.audit = audit;
    }

    @GetMapping(value = "/reed/submodels/{assetId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> submodel(@PathVariable String assetId,
                                           @RequestHeader(value = "X-Api-Key", required = false) String apiKey,
                                           @RequestHeader(value = "X-Reed-Bpn", required = false) String requesterBpn) {
        if (apiKey == null || !apiKey.equals(props.getApiKey())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing or invalid X-Api-Key");
        }
        var assetClass = AssetClass.fromAssetId(assetId);
        if (assetClass == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown asset " + assetId);
        }
        var payload = readResource(assetClass);

        audit.save(new AuditEvent(EventType.PULL, requesterBpn, assetId,
                "confidential payload pulled via EDR data-plane"));

        return ResponseEntity.ok(payload);
    }

    private String readResource(AssetClass assetClass) {
        var resource = new ClassPathResource(assetClass.submodelResource());
        try (var in = resource.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "payload missing for " + assetClass, e);
        }
    }
}
