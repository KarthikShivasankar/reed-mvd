/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.usage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.contract.ContractService;
import org.example.reed.domain.Asset;
import org.example.reed.domain.AssetClass;
import org.example.reed.domain.Offering;
import org.example.reed.domain.Participant;
import org.example.reed.domain.PolicyDecision;
import org.example.reed.policy.opa.OpaClient;
import org.example.reed.policy.opa.PolicyDecisionService;
import org.example.reed.repo.OfferingRepository;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.factory.FactoryService;
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
import java.util.LinkedHashMap;
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

    /** {@code purpose}: what the consumer declared with its request ({@code ?purpose=}), if anything. */
    public record Request(String assetId, String consumerDid, String purpose) {
    }

    /** The enforcement point's report of what its Open Policy Agent answered ({@code result}). */
    public record Report(String assetId, String consumerDid, String purpose, JsonNode result) {
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
    private final FactoryService factory;
    private final OfferingRepository offerings;
    private final ContractService contracts;
    private final PolicyDecisionService decisions;
    private final OpaClient opa;

    public UsageController(AssetRepository assets, ParticipantRepository participants, PolicyTemplateRepository templates,
                           PolicyTemplateRenderer renderer, ConnectorClient connectors, AuditEventRepository audit,
                           ObjectMapper mapper, Clock clock, @Value("${reed.usage.data-keys:}") String dataKeys,
                           @Value("${reed.usage.pilot-days}") long pilotDays, FactoryService factory,
                           OfferingRepository offerings, ContractService contracts, PolicyDecisionService decisions, OpaClient opa) {
        this.offerings = offerings;
        this.contracts = contracts;
        this.decisions = decisions;
        this.opa = opa;
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
        this.factory = factory;
    }

    @PostMapping("/reed/usage/decide")
    public ResponseEntity<Map<String, Object>> decide(@RequestHeader(value = "X-Data-Service", required = false) String company,
                                                      @RequestHeader(value = "X-Api-Key", required = false) String key,
                                                      @RequestBody Request r) {
        var expected = company == null ? null : dataKeys.get(company);
        if (!dataService(company, key)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("allow", false, "reason", "unknown data service"));
        }
        var owner = participants.findByConnectorName(company).orElse(null);
        var asset = r.assetId() == null ? null : assets.findById(r.assetId()).orElse(null);
        if (owner == null || asset == null || !asset.ownerBpn.equals(owner.bpn)) {
            return deny(owner == null ? null : owner.bpn, r.assetId(), "asset does not belong to " + company);
        }
        var consumer = r.consumerDid() == null ? null : participants.findByDid(r.consumerDid()).orElse(null);
        // An asset behind a published capability offering: its compound policy is decided by the owner's
        // Open Policy Agent, so that every condition shows up in the decision. Membership is one of them
        // whatever the provider wrote (RegoMapper.enforced), so a non-member is denied there, not let through.
        var offering = offerings.findFirstByAssetId(asset.assetId)
                .filter(o -> o.published && o.policyTemplate.equals(asset.policyTemplate)).orElse(null);
        if (consumer == null || (offering == null && !consumer.consortium)) {
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
        if (offering != null) {
            return governed(company, owner, consumer, asset, offering, r.purpose(), licence, now);
        }
        audit.save(new AuditEvent(EventType.PULL, owner.bpn, asset.assetId, "confidential payload of " + owner.bpn
                + " released by its data service to " + consumer.bpn + " (verified: contract agreement " + licence.agreementId()
                + (licence.expiresAt() != null ? ", licence until " + licence.expiresAt() : "") + ")"));
        // A company's production status carries its shop floor's state right now (when it runs a line in REED).
        if (asset.assetClass == AssetClass.ProductionStatus && factory.hasLine(company)) {
            return ResponseEntity.ok(Map.of("allow", true, "license", licence, "shopFloor", factory.summary(company)));
        }
        return ResponseEntity.ok(Map.of("allow", true, "license", licence));
    }

    /**
     * The pre-checks passed; whether the payload leaves is now the owner's own decision point's call. The answer
     * tells the enforcement point where to ask (its company's OPA) and with which input: REED is the policy
     * information point, so the consumer's attributes come from the registry, never from the request. Only the
     * declared purpose is the consumer's own statement.
     */
    private ResponseEntity<Map<String, Object>> governed(String company, Participant owner, Participant consumer, Asset asset,
                                                         Offering offering, String purpose, Licence licence, Instant now) {
        var contract = contracts.covering(asset.assetId, consumer.bpn, purpose(purpose), now);
        var policyId = contract != null ? contract.policyId : offering.policyTemplate;
        try {
            decisions.ensure(company, policyId, contract != null ? contract.rego : decisions.offeringRego(offering));
        } catch (Exception e) {
            return deny(owner.bpn, asset.assetId, "policy decision point of " + company + " unavailable");
        }
        var input = decisions.input(consumer, owner, offering, contract, contract == null ? null : contracts.status(contract, now).name(),
                contract == null ? null : contract.purpose, purpose(purpose), "use", now);
        if (contract != null) {
            licence = new Licence(licence.licensee(), licence.licenseeDid(), licence.owner(), licence.assetId(), licence.agreementId(),
                    licence.issuedAt(), contract.expiryDate.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant(),
                    licence.prohibitions(), licence.obligations());
        }
        var body = new LinkedHashMap<String, Object>();
        body.put("allow", true);
        body.put("license", licence);
        body.put("opa", Map.of("decisionPoint", opa.url(company), "path", OpaClient.path(policyId, "decision"), "input", input));
        if (asset.assetClass == AssetClass.ProductionStatus && factory.hasLine(company)) {
            body.put("shopFloor", factory.summary(company));
        }
        return ResponseEntity.ok(body);
    }

    /**
     * The enforcement point reports what its Open Policy Agent decided: the decision log entry and the PULL
     * audit event. The data service enforces OPA's answer itself; if this report cannot be stored it must not
     * release the payload (no unaudited exchange).
     */
    @PostMapping("/reed/usage/decisions")
    public ResponseEntity<Map<String, Object>> report(@RequestHeader(value = "X-Data-Service", required = false) String company,
                                                      @RequestHeader(value = "X-Api-Key", required = false) String key,
                                                      @RequestBody Report r) {
        if (!dataService(company, key)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("recorded", false, "reason", "unknown data service"));
        }
        var owner = participants.findByConnectorName(company).orElse(null);
        var asset = r.assetId() == null ? null : assets.findById(r.assetId()).orElse(null);
        var consumer = r.consumerDid() == null ? null : participants.findByDid(r.consumerDid()).orElse(null);
        var offering = asset == null ? null : offerings.findFirstByAssetId(asset.assetId).orElse(null);
        if (owner == null || asset == null || consumer == null || offering == null || !asset.ownerBpn.equals(owner.bpn) || r.result() == null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("recorded", false, "reason", "not a decision about an offering of " + company));
        }
        // the same choice as in decide: the module the enforcement point was sent to names it
        var contract = contracts.covering(asset.assetId, consumer.bpn, purpose(r.purpose()), clock.instant());
        var outcome = decisions.outcome(PolicyDecision.Stage.RUNTIME, new PolicyDecisionService.Subject(consumer.bpn, owner.bpn,
                contract == null ? null : contract.id, offering.id, contract == null ? null : contract.rfqId, asset.assetId, "use",
                purpose(r.purpose())), r.result(), opa.url(company), true);
        audit.save(new AuditEvent(EventType.PULL, owner.bpn, asset.assetId, outcome.allowed()
                ? "payload of " + owner.bpn + " released by its data service to " + consumer.bpn + " (Open Policy Agent of " + company
                + ": ALLOW" + (contract == null ? "" : ", contract " + contract.id) + ")"
                : "payload release to " + consumer.bpn + " DENIED by the Open Policy Agent of " + company + ": "
                + outcome.failed().stream().map(PolicyDecisionService.Condition::label).collect(java.util.stream.Collectors.joining("; "))));
        return ResponseEntity.ok(Map.of("recorded", true, "decision", outcome.decision(), "explanation", outcome.explanation()));
    }

    private boolean dataService(String company, String key) {
        var expected = company == null ? null : dataKeys.get(company);
        return expected != null && key != null
                && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8));
    }

    /** A declared purpose is a short token; anything else counts as none declared. */
    private static String purpose(String p) {
        return p != null && p.matches("[a-z0-9-]{1,64}") ? p : "";
    }

    private ResponseEntity<Map<String, Object>> deny(String ownerBpn, String assetId, String reason) {
        audit.save(new AuditEvent(EventType.PULL, ownerBpn, assetId, "payload release DENIED: " + reason));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("allow", false, "reason", reason));
    }
}
