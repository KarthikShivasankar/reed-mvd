/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.usage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.policy.PolicyTemplateRenderer;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Usage decisions for the companies' data services. Before a data service releases a payload to the
 * consumer its EDC data plane names, it asks here:
 * <ul>
 *   <li>the caller must be that company's data service (its own data key);</li>
 *   <li>the consumer must be a known member holding a contract agreement for the asset on the owner's
 *       connector (negotiated over DSP with the consumer's credentials);</li>
 *   <li>a time-limited licence (pilot access) must not have expired.</li>
 * </ul>
 * Every decision is a PULL audit event (allowed or denied). The answer carries the licence the data
 * service stamps onto the payload.
 */
@RestController
public class UsageController {

    public record Request(String assetId, String consumerDid) {
    }

    private final AssetRepository assets;
    private final ParticipantRepository participants;
    private final PolicyTemplateRepository templates;
    private final PolicyTemplateRenderer renderer;
    private final ConnectorClient connectors;
    private final AuditEventRepository audit;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final Map<String, String> dataKeys;
    private final Duration pilotLength;

    public UsageController(AssetRepository assets, ParticipantRepository participants, PolicyTemplateRepository templates,
                           PolicyTemplateRenderer renderer, ConnectorClient connectors, AuditEventRepository audit,
                           ObjectMapper mapper, Clock clock, @Value("${reed.usage.data-keys:}") String dataKeys,
                           @Value("${reed.usage.pilot-days}") long pilotDays) {
        this.assets = assets;
        this.participants = participants;
        this.templates = templates;
        this.renderer = renderer;
        this.connectors = connectors;
        this.audit = audit;
        this.mapper = mapper;
        this.clock = clock;
        this.dataKeys = ConnectorClient.parse(dataKeys);
        this.pilotLength = Duration.ofDays(pilotDays);
    }

    @PostMapping("/reed/usage/decide")
    public ResponseEntity<Map<String, Object>> decide(@RequestHeader(value = "X-Data-Service", required = false) String company,
                                                      @RequestHeader(value = "X-Api-Key", required = false) String key,
                                                      @RequestBody Request r) {
        var expected = company == null ? null : dataKeys.get(company);
        if (expected == null || key == null
                || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("allow", false, "reason", "unknown data service"));
        }
        var owner = participants.findByConnectorName(company).orElse(null);
        var asset = r.assetId() == null ? null : assets.findById(r.assetId()).orElse(null);
        if (owner == null || asset == null || !asset.ownerBpn.equals(owner.bpn)) {
            return deny(owner == null ? null : owner.bpn, r.assetId(), "asset does not belong to " + company);
        }
        var consumer = r.consumerDid() == null ? null : participants.findByDid(r.consumerDid()).orElse(null);
        if (consumer == null || !consumer.consortium) {
            return deny(owner.bpn, asset.assetId, "consumer is not a known consortium member");
        }
        JsonNode agreement;
        try {
            var query = mapper.writeValueAsString(Map.of(
                    "@context", List.of("https://w3id.org/edc/connector/management/v2"), "@type", "QuerySpec",
                    "limit", 1, "sortField", "contractSigningDate", "sortOrder", "DESC",
                    "filterExpression", List.of(
                            Map.of("@type", "Criterion", "operandLeft", "assetId", "operator", "=", "operandRight", asset.assetId),
                            Map.of("@type", "Criterion", "operandLeft", "consumerId", "operator", "=", "operandRight", r.consumerDid()))));
            var found = mapper.readTree(connectors.post(owner.connectorName, owner.managementUrl, "/v4/contractagreements/request", query));
            agreement = found.isArray() && !found.isEmpty() ? found.get(0) : null;
        } catch (Exception e) {
            return deny(owner.bpn, asset.assetId, "contract agreements of " + company + " unavailable");
        }
        if (agreement == null) {
            return deny(owner.bpn, asset.assetId, consumer.bpn + " holds no contract agreement for this asset");
        }
        var odrl = templates.findById(asset.policyTemplate).map(t -> renderer.render(t, consumer.bpn, owner.bpn, asset.assetId))
                .orElse(mapper.createObjectNode());
        var now = clock.instant();
        var licence = Licence.of(odrl, consumer.bpn, r.consumerDid(), owner.bpn, asset.assetId, agreement.path("@id").asText(),
                Instant.ofEpochSecond(agreement.path("contractSigningDate").asLong()), now, pilotLength);
        if (licence.expired(now)) {
            return deny(owner.bpn, asset.assetId, "licence of " + consumer.bpn + " expired at " + licence.expiresAt());
        }
        audit.save(new AuditEvent(EventType.PULL, owner.bpn, asset.assetId, "confidential payload of " + owner.bpn
                + " released by its data service to " + consumer.bpn + " (verified: contract agreement " + licence.agreementId()
                + (licence.expiresAt() != null ? ", licence until " + licence.expiresAt() : "") + ")"));
        return ResponseEntity.ok(Map.of("allow", true, "license", licence));
    }

    private ResponseEntity<Map<String, Object>> deny(String ownerBpn, String assetId, String reason) {
        audit.save(new AuditEvent(EventType.PULL, ownerBpn, assetId, "payload release DENIED: " + reason));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("allow", false, "reason", reason));
    }
}
