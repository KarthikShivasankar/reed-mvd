/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.config.ReedProperties;
import org.example.reed.domain.Asset;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.ParticipantRepository;
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
import java.util.List;
import java.util.Map;

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
    private final ParticipantRepository participants;
    private final ConnectorClient connectors;
    private final ObjectMapper mapper;

    public SubmodelController(ReedProperties props, AssetRepository assets, AuditEventRepository audit,
                              ParticipantRepository participants, ConnectorClient connectors, ObjectMapper mapper) {
        this.props = props;
        this.assets = assets;
        this.audit = audit;
        this.participants = participants;
        this.connectors = connectors;
        this.mapper = mapper;
    }

    /**
     * The owner's data plane names the consumer from the EDR token it has just verified. That is the
     * owner's assertion, so the owner stays the audit actor; REED cross-checks it against the contract
     * agreements on the owner's connector (negotiated over DSP with the consumer's credentials) and
     * records the consumer only if it is a known member.
     */
    private String consumerNote(Asset asset, String consumerDid) {
        if (consumerDid == null) {
            return "";
        }
        var consumer = participants.findByDid(consumerDid).orElse(null);
        if (consumer == null) {
            return " by an unrecognised consumer";
        }
        var owner = participants.findById(asset.ownerBpn).orElse(null);
        if (owner == null || owner.connectorName == null) {
            return " by " + consumer.bpn + " (asserted by the owner's data plane)";
        }
        try {
            var query = mapper.writeValueAsString(Map.of(
                    "@context", List.of("https://w3id.org/edc/connector/management/v2"),
                    "@type", "QuerySpec", "limit", 1,
                    "filterExpression", List.of(
                            Map.of("@type", "Criterion", "operandLeft", "assetId", "operator", "=", "operandRight", asset.assetId),
                            Map.of("@type", "Criterion", "operandLeft", "consumerId", "operator", "=", "operandRight", consumerDid))));
            var agreements = mapper.readTree(connectors.post(owner.connectorName, owner.managementUrl,
                    "/v4/contractagreements/request", query));
            return agreements.isArray() && !agreements.isEmpty()
                    ? " by " + consumer.bpn + " (verified: contract agreement " + agreements.get(0).path("@id").asText() + ")"
                    : " by " + consumer.bpn + " (asserted by the owner's data plane, but no matching contract agreement)";
        } catch (Exception e) {
            return " by " + consumer.bpn + " (asserted by the owner's data plane; agreement check unavailable)";
        }
    }

    @GetMapping(value = "/reed/submodels/{assetId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> submodel(@PathVariable String assetId,
                                           @RequestHeader(value = "X-Api-Key", required = false) String apiKey,
                                           @RequestHeader(value = "X-Edc-Consumer", required = false) String consumerDid) {
        var asset = assets.findById(assetId).orElse(null);
        // Same answer for unknown assets and wrong keys, so the endpoint cannot be used to probe ids.
        if (asset == null || apiKey == null || !MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8),
                props.ownerKey(asset.ownerBpn).getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing or invalid X-Api-Key for this asset's owner");
        }
        audit.save(new AuditEvent(EventType.PULL, asset.ownerBpn, assetId,
                "confidential payload of " + asset.ownerBpn + " pulled via EDR data plane" + consumerNote(asset, consumerDid)));
        return ResponseEntity.ok(asset.payload);
    }
}
