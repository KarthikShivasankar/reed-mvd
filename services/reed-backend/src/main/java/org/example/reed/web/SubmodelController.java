/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.config.ReedProperties;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

/**
 * The REED <b>submodel service</b>: serves the confidential payload for an
 * asset. Only the owners' EDC data-plane proxies call it (with the per-owner
 * {@code X-Api-Key} carried in the asset's data address), and only after the
 * consumer presented a valid EDR - i.e. after a contract was agreed. Every pull
 * is recorded as a {@code PULL} audit event (usage layer).
 */
@RestController
public class SubmodelController {

    private final ReedProperties props;
    private final AssetRepository assets;
    private final AuditEventRepository audit;

    public SubmodelController(ReedProperties props, AssetRepository assets, AuditEventRepository audit) {
        this.props = props;
        this.assets = assets;
        this.audit = audit;
    }

    @GetMapping(value = "/reed/submodels/{assetId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> submodel(@PathVariable String assetId,
                                           @RequestHeader(value = "X-Api-Key", required = false) String apiKey) {
        var asset = assets.findById(assetId).orElse(null);
        // Same answer for unknown assets and wrong keys, so the endpoint cannot be used to probe ids.
        if (asset == null || apiKey == null || !MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8),
                props.ownerKey(asset.ownerBpn).getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing or invalid X-Api-Key for this asset's owner");
        }
        audit.save(new AuditEvent(EventType.PULL, asset.ownerBpn, assetId,
                "confidential payload of " + asset.ownerBpn + " pulled via EDR data plane"));
        return ResponseEntity.ok(asset.payload);
    }
}
