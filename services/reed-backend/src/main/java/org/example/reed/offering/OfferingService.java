/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.offering;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.Contract;
import org.example.reed.domain.Discoverability;
import org.example.reed.domain.EventType;
import org.example.reed.domain.Offering;
import org.example.reed.domain.Participant;
import org.example.reed.domain.PolicyDecision;
import org.example.reed.domain.PolicyTemplate;
import org.example.reed.domain.Rfq;
import org.example.reed.policy.PolicyEvaluator;
import org.example.reed.policy.PolicyService;
import org.example.reed.policy.odrl.ConstraintKind;
import org.example.reed.policy.odrl.OdrlParser;
import org.example.reed.policy.odrl.PolicyNode;
import org.example.reed.policy.odrl.RegoMapper;
import org.example.reed.policy.opa.OpaClient;
import org.example.reed.policy.opa.PolicyDecisionService;
import org.example.reed.policy.opa.PolicyDecisionService.Condition;
import org.example.reed.policy.opa.PolicyDecisionService.Outcome;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.ContractRepository;
import org.example.reed.repo.OfferingRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The capability catalogue: providers publish offerings with a compound ODRL policy, and a service RFQ
 * is matched against them in two separate steps - does the capability fit, and may this buyer have it.
 */
@Service
public class OfferingService {

    /** More conditions than anyone can read are not a policy, and every one is a rule each decision evaluates. */
    static final int MAX_CONDITIONS = 24;

    public static final List<String> RESOURCE_KINDS = List.of("SERVICE", "DATASET", "API", "AVAILABILITY", "CAPACITY", "PARAMETERS", "DIGITAL_TWIN");

    /** One ODRL constraint as the dashboard's policy builder (and the roster) sends it. */
    public record ConstraintForm(String leftOperand, String operator, String rightOperand) {
    }

    public record OfferingForm(String name, String capability, String resourceKind, String resource, String description,
                               List<String> keywords, Integer capacityPerMonth, String assetId, List<ConstraintForm> policy) {
    }

    /** A policy at every level the dashboard shows: ODRL, its conditions in words, the combined sentence, the Rego. */
    public record PolicyView(String policyId, JsonNode odrl, List<Condition> components, String effective, String rego) {
    }

    public record OfferingView(String id, String name, String capability, String resourceKind, String resource, String description,
                               List<String> keywords, Integer capacityPerMonth, String providerBpn, String provider,
                               String providerCountry, String connector, String assetId, boolean published, Instant createdAt,
                               Instant publishedAt, PolicyView policy) {
    }

    /** {@code policy} is null when the capability does not match: eligibility is only asked for real candidates. */
    public record MatchResult(OfferingView offering, List<OfferingMatcher.Check> capabilityChecks, boolean capabilityMatch,
                              Outcome policy, boolean policyEligible, boolean eligible, String contractId, String contractStatus) {
    }

    private final OfferingRepository offerings;
    private final PolicyTemplateRepository templates;
    private final ParticipantRepository participants;
    private final AssetRepository assets;
    private final ContractRepository contracts;
    private final AuditEventRepository audit;
    private final PolicyDecisionService decisions;
    private final PolicyService policies;
    private final OpaClient opa;
    private final ObjectMapper mapper;
    private final Clock clock;

    public OfferingService(OfferingRepository offerings, PolicyTemplateRepository templates, ParticipantRepository participants,
                           AssetRepository assets, ContractRepository contracts, AuditEventRepository audit,
                           PolicyDecisionService decisions, PolicyService policies, OpaClient opa, ObjectMapper mapper, Clock clock) {
        this.offerings = offerings;
        this.templates = templates;
        this.participants = participants;
        this.assets = assets;
        this.contracts = contracts;
        this.audit = audit;
        this.decisions = decisions;
        this.policies = policies;
        this.opa = opa;
        this.mapper = mapper;
        this.clock = clock;
    }

    // ---------------------------------------------------------------- catalogue

    /** Published offerings, plus the viewer's own drafts ({@code all}: the operator sees every draft). */
    public List<OfferingView> list(String viewerBpn, boolean all) {
        return offerings.findAllByOrderByName().stream()
                .filter(o -> o.published || all || o.providerBpn.equals(viewerBpn)).map(this::view).toList();
    }

    public Offering get(String id) {
        return offerings.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown offering " + id));
    }

    public OfferingView view(Offering o) {
        var p = participants.findById(o.providerBpn).orElseThrow();
        return new OfferingView(o.id, o.name, o.capability, o.resourceKind, o.resource, o.description, o.keywords, o.capacityPerMonth,
                o.providerBpn, p.name, p.country, p.connectorName, o.assetId, o.published, o.createdAt, o.publishedAt,
                policyView(o.policyTemplate, decisions.offeringOdrl(o), decisions.offeringRego(o)));
    }

    public PolicyView policyView(String policyId, JsonNode odrl, String rego) {
        var components = decisions.components(OdrlParser.parse(odrl));
        var effective = components.isEmpty() ? "ALLOW any request"
                : "ALLOW only when " + components.stream().map(Condition::label).collect(Collectors.joining(" AND "));
        return new PolicyView(policyId, odrl, components, effective, rego);
    }

    /** ODRL constraints -> the policy at every level, nothing stored: the builder's live preview. */
    public PolicyView translate(String ownerBpn, List<ConstraintForm> constraints) {
        var policy = parse(constraints, ownerBpn);
        var odrl = OdrlParser.document("Offer", "preview", ownerBpn, null, null, policy);
        return policyView("preview", odrl, RegoMapper.toRego("preview", policy, null, decisions.names()));
    }

    @Transactional
    public Offering create(String ownerBpn, String id, OfferingForm f) {
        if (blank(f.name()) || blank(f.capability()) || f.resourceKind() == null || !RESOURCE_KINDS.contains(f.resourceKind())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name, capability and resourceKind (" + String.join(", ", RESOURCE_KINDS) + ") are mandatory");
        }
        if (f.name().length() > 200 || OfferingService.slug(f.capability()).isEmpty() || f.capability().length() > 60
                || len(f.resource()) > 200 || len(f.description()) > 1000
                || (f.keywords() != null && (f.keywords().size() > 30 || f.keywords().stream().anyMatch(k -> k == null || k.length() > 60)))
                || (f.capacityPerMonth() != null && f.capacityPerMonth() < 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name, capability, resource, description or keywords too long or malformed");
        }
        if (f.assetId() != null && assets.findById(f.assetId()).filter(a -> a.ownerBpn.equals(ownerBpn)).isEmpty()) {
            // same answer for a missing asset and someone else's: no existence oracle
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown asset " + f.assetId());
        }
        if (f.assetId() != null && offerings.findFirstByAssetId(f.assetId()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "asset " + f.assetId() + " already belongs to an offering");
        }
        var o = new Offering();
        o.id = id != null ? id : slug(f.capability()) + "-" + UUID.randomUUID().toString().substring(0, 6);
        o.providerBpn = ownerBpn;
        o.name = f.name().strip();
        o.capability = slug(f.capability());
        o.resourceKind = f.resourceKind();
        o.resource = f.resource();
        o.description = f.description();
        o.keywords = f.keywords() == null ? List.of() : f.keywords().stream().map(String::strip).filter(k -> !k.isEmpty()).toList();
        o.capacityPerMonth = f.capacityPerMonth();
        o.assetId = f.assetId();
        o.policyTemplate = "offering-" + o.id;
        o.createdAt = clock.instant();
        storePolicy(o, f.policy());
        offerings.save(o);
        audit.save(new AuditEvent(EventType.POLICY, ownerBpn, o.assetId, "capability " + o.id + " (" + o.name + ") registered with policy "
                + o.policyTemplate + ": " + policyView(o.policyTemplate, decisions.offeringOdrl(o), "").effective()));
        return o;
    }

    /** The provider changes the offering's policy. Contracts already made keep the policy they were agreed under. */
    @Transactional
    public Offering setPolicy(Offering o, List<ConstraintForm> constraints) {
        storePolicy(o, constraints);
        if (o.published) {
            deploy(o);
        }
        audit.save(new AuditEvent(EventType.POLICY, o.providerBpn, o.assetId, "policy of capability " + o.id + " changed: "
                + policyView(o.policyTemplate, decisions.offeringOdrl(o), "").effective()));
        return o;
    }

    private void storePolicy(Offering o, List<ConstraintForm> constraints) {
        var policy = parse(constraints, o.providerBpn);
        var odrl = OdrlParser.document("Offer", o.policyTemplate, o.providerBpn, null, o.assetId, policy).toString();
        var t = templates.findById(o.policyTemplate).orElse(null);
        if (t == null) {
            templates.save(new PolicyTemplate(o.policyTemplate, "Policy of the capability offering " + o.name, odrl));
        } else {
            t.odrl = odrl;
            templates.save(t);
        }
    }

    /** Validates the constraints against the supported ODRL subset; {@code $EEA}, {@code $EU} and {@code $OWNER_BPN} are expanded. */
    private PolicyNode parse(List<ConstraintForm> constraints, String ownerBpn) {
        var f = JsonNodeFactory.instance;
        var and = f.arrayNode();
        if (constraints != null && constraints.size() > MAX_CONDITIONS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "a policy has at most " + MAX_CONDITIONS + " conditions");
        }
        for (var c : constraints == null ? List.<ConstraintForm>of() : constraints) {
            if (c == null || c.leftOperand() == null || len(c.rightOperand()) > 400) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "malformed policy condition");
            }
            and.add(f.objectNode().put("leftOperand", c.leftOperand()).put("operator", c.operator() == null ? "eq" : c.operator())
                    .put("rightOperand", macros(c.rightOperand(), ownerBpn)));
        }
        PolicyNode policy;
        try {
            policy = OdrlParser.parse(f.objectNode().set("permission",
                    f.arrayNode().add(f.objectNode().put("action", "use").set("constraint", f.objectNode().set("and", and)))));
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
        // A relation is always with the provider: the connector checks the BPN in the constraint, Open Policy
        // Agent the relation with the provider - they must be the same company.
        for (var a : PolicyNode.atoms(policy)) {
            if ((a.kind() == ConstraintKind.BILATERAL || a.kind() == ConstraintKind.PROJECT) && !a.value().equals(ownerBpn)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "a relationship condition is about the provider itself ($OWNER_BPN)");
            }
        }
        return policy;
    }

    public static String macros(String right, String ownerBpn) {
        var eu = String.join(",", PolicyEvaluator.EU27);
        return right == null ? "" : right.replace("$EEA", eu + "," + String.join(",", PolicyEvaluator.EEA_EFTA)).replace("$EU", eu)
                .replace("$OWNER_BPN", ownerBpn);
    }

    /**
     * Publishes the offering: it becomes matchable, its asset takes the offering's policy on the provider's
     * connector (the credential constraints, as CEL), and its Rego goes to REED's and the provider's OPA.
     */
    @Transactional
    public Offering publish(Offering o, String username) {
        o.published = true;
        o.publishedAt = clock.instant();
        offerings.save(o);
        deploy(o);
        audit.save(new AuditEvent(EventType.POLICY, o.providerBpn, o.assetId, username + " published capability " + o.id
                + " with policy " + o.policyTemplate));
        return o;
    }

    private void deploy(Offering o) {
        var provider = participants.findById(o.providerBpn).orElseThrow();
        var rego = decisions.offeringRego(o);
        opa.deploy(OpaClient.REED, o.policyTemplate, rego);
        if (provider.connectorName == null) {
            return;
        }
        opa.deploy(provider.connectorName, o.policyTemplate, rego);
        if (o.assetId != null) {
            var a = assets.findById(o.assetId).orElseThrow();
            // discoverable to every member: who may contract for it is the policy's business
            a.discoverability = Discoverability.consortium;
            a.policyTemplate = o.policyTemplate;
            assets.save(a);
            policies.publish(a);
        }
    }

    // ---------------------------------------------------------------- matchmaking

    /**
     * Capability match, then policy eligibility, then the final answer - kept apart so the buyer sees
     * which of the two said no, and why.
     */
    public List<MatchResult> matches(Rfq rfq, boolean record) {
        var buyer = participants.findById(rfq.buyerBpn).orElseThrow();
        var demand = new OfferingMatcher.Demand(rfq.capability, rfq.keywords, rfq.requiredCapacity, rfq.preferredRegion);
        var at = rfq.startDate == null ? clock.instant() : rfq.startDate.atStartOfDay(ZoneOffset.UTC).toInstant();
        var out = new ArrayList<MatchResult>();
        for (var o : offerings.findAllByOrderByName()) {
            var provider = participants.findById(o.providerBpn).orElseThrow();
            if (!o.published || o.providerBpn.equals(rfq.buyerBpn) || !provider.consortium) {
                continue;
            }
            var checks = OfferingMatcher.checks(demand, new OfferingMatcher.Supply(o.capability, o.name,
                    o.description == null ? "" : o.description, o.keywords, o.capacityPerMonth, provider.country));
            var capable = OfferingMatcher.matches(checks);
            var policy = capable ? decisions.eligibility(o, buyer, rfq.id, rfq.purpose, at, PolicyDecision.Stage.MATCH, record) : null;
            var today = java.time.LocalDate.now(clock);
            var contract = contracts.findFirstByRfqIdAndOfferingIdOrderByCreatedAtDesc(rfq.id, o.id)
                    .filter(c -> c.status != Contract.Status.TERMINATED && c.status != Contract.Status.EXPIRED
                            && !(c.status == Contract.Status.ACTIVE && today.isAfter(c.expiryDate))).orElse(null);
            out.add(new MatchResult(view(o), checks, capable, policy, policy != null && policy.allowed(),
                    policy != null && policy.allowed(), contract == null ? null : contract.id,
                    contract == null ? null : contract.status.name()));
        }
        out.sort(Comparator.comparing((MatchResult m) -> !m.eligible()).thenComparing(m -> !m.capabilityMatch())
                .thenComparing(m -> m.offering().name()));
        return out;
    }

    private static int len(String s) {
        return s == null ? 0 : s.length();
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    static String slug(String s) {
        return s.strip().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
    }
}
