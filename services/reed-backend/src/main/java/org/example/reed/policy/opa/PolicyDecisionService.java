/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy.opa;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.domain.Contract;
import org.example.reed.domain.Offering;
import org.example.reed.domain.Participant;
import org.example.reed.domain.PolicyDecision;
import org.example.reed.domain.RelationType;
import org.example.reed.participant.CredentialVerifier;
import org.example.reed.policy.PolicyEvaluator;
import org.example.reed.policy.PolicyTemplateRenderer;
import org.example.reed.policy.odrl.OdrlParser;
import org.example.reed.policy.odrl.PolicyNode;
import org.example.reed.policy.odrl.RegoMapper;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyDecisionRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.example.reed.repo.SupplyChainRelationRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Everything between REED and a policy decision: the OPA input document (REED is the policy
 * information point - the requester's attributes come from the registry, never from the caller),
 * the Rego of an offering's policy, asking REED's own OPA at matchmaking time, and the decision log.
 */
@Service
public class PolicyDecisionService {

    /** The purposes a buyer can declare; {@link #PILOT} marks the engagement as a pilot project. */
    public static final List<String> PURPOSES = List.of("pilot-evaluation", "production", "research", "quality-assurance", "maintenance");
    public static final String PILOT = "pilot-evaluation";

    public record Condition(String id, String kind, String label, boolean pass) {
    }

    public record Outcome(Long id, String stage, String decision, String policyId, String decidedBy, List<Condition> conditions,
                          List<Condition> failed, String explanation, Instant at) {
        public boolean allowed() {
            return "ALLOW".equals(decision);
        }
    }

    /** What a decision was about (ids only; any may be null). */
    public record Subject(String requesterBpn, String providerBpn, String contractId, String offeringId, String rfqId,
                          String assetId, String action, String purpose) {
    }

    private final OpaClient opa;
    private final PolicyDecisionRepository decisions;
    private final PolicyTemplateRepository templates;
    private final PolicyTemplateRenderer renderer;
    private final ParticipantRepository participants;
    private final SupplyChainRelationRepository relations;
    private final CredentialVerifier credentials;
    private final ObjectMapper mapper;

    public PolicyDecisionService(OpaClient opa, PolicyDecisionRepository decisions, PolicyTemplateRepository templates,
                                 PolicyTemplateRenderer renderer, ParticipantRepository participants,
                                 SupplyChainRelationRepository relations, CredentialVerifier credentials, ObjectMapper mapper) {
        this.opa = opa;
        this.decisions = decisions;
        this.templates = templates;
        this.renderer = renderer;
        this.participants = participants;
        this.relations = relations;
        this.credentials = credentials;
        this.mapper = mapper;
    }

    // ---------------------------------------------------------------- policies

    /** BPN -> company name, for condition texts. */
    public Function<String, String> names() {
        var names = participants.findAll().stream().collect(Collectors.toMap(p -> p.bpn, p -> p.shortName == null ? p.name : p.shortName));
        return bpn -> names.getOrDefault(bpn, bpn);
    }

    public JsonNode offeringOdrl(Offering o) {
        var t = templates.findById(o.policyTemplate).orElseThrow(() -> new IllegalStateException("offering " + o.id + " has no policy"));
        return renderer.render(t, "*", o.providerBpn, o.assetId);
    }

    public PolicyNode offeringPolicy(Offering o) {
        return OdrlParser.parse(offeringOdrl(o));
    }

    public String offeringRego(Offering o) {
        return RegoMapper.toRego(o.policyTemplate, offeringPolicy(o), null, names());
    }

    /** The conditions of a policy in words, in the order of the generated rules (c1, c2, ...). */
    public List<Condition> components(PolicyNode policy) {
        var names = names();
        var out = new ArrayList<Condition>();
        for (var a : RegoMapper.enforced(policy)) {  // what is shown is what the Rego checks
            out.add(new Condition("c" + (out.size() + 1), a.kind().name(), a.kind().label(a, names), true));
        }
        return out;
    }

    /**
     * Deploys the module unless that OPA holds exactly this text. OPA keeps policies in memory (gone after its
     * restart), and a module left from an earlier policy or an earlier REED version must not keep deciding.
     */
    public void ensure(String opaName, String policyId, String rego) {
        if (!rego.equals(opa.deployed(opaName, policyId))) {
            opa.deploy(opaName, policyId, rego);
        }
    }

    // ---------------------------------------------------------------- input document

    /**
     * The OPA input for one request.
     *
     * @param contract          the contract the request falls under, or null
     * @param engagementPurpose the purpose of the RFQ/contract the request belongs to (decides "pilot project")
     * @param purpose           the purpose declared with this request
     */
    public Map<String, Object> input(Participant requester, Participant provider, Offering offering, Contract contract,
                                     String contractStatus, String engagementPurpose, String purpose, String action, Instant now) {
        var r = new LinkedHashMap<String, Object>();
        r.put("bpn", requester.bpn);
        r.put("name", requester.name);
        r.put("orgType", requester.role);
        r.put("country", requester.country);
        r.put("eea", requester.country != null
                && (PolicyEvaluator.EU27.contains(requester.country) || PolicyEvaluator.EEA_EFTA.contains(requester.country)));
        r.put("membership", requester.membershipStatus);
        r.put("verified", requester.verified);
        r.put("competitor", competitors(requester, provider));
        r.put("bilateral", related(requester.bpn, provider.bpn, false));
        r.put("project", related(requester.bpn, provider.bpn, true));
        r.put("certifications", credentials.verifiedCerts(requester));

        var c = new LinkedHashMap<String, Object>();
        if (contract != null) {
            c.put("id", contract.id);
            c.put("status", contractStatus);
        }
        c.put("pilot", PILOT.equals(engagementPurpose));

        var input = new LinkedHashMap<String, Object>();
        input.put("requester", r);
        input.put("provider", Map.of("bpn", provider.bpn, "name", provider.name));
        input.put("contract", c);
        input.put("capability", offering.id);
        input.put("asset", offering.assetId == null ? "" : offering.assetId);
        input.put("action", action);
        input.put("purpose", purpose == null ? "" : purpose);
        input.put("now", now.toString());
        return input;
    }

    /** Two companies compete when they share a market segment. */
    public static boolean competitors(Participant a, Participant b) {
        return a.competitorClasses != null && b.competitorClasses != null
                && !Collections.disjoint(a.competitorClasses, b.competitorClasses);
    }

    private boolean related(String a, String b, boolean project) {
        return java.util.stream.Stream.concat(relations.findByParentBpnAndChildBpn(a, b).stream(),
                        relations.findByParentBpnAndChildBpn(b, a).stream())
                .anyMatch(x -> (x.relationType == RelationType.PROJECT_MEMBER) == project);
    }

    // ---------------------------------------------------------------- decisions

    /**
     * Matchmaking-time (or what-if): may this company have this offering? Asked of REED's own OPA.
     *
     * @param record false for repeated reads (a ranking being looked at), true when it is a step that counts
     */
    public Outcome eligibility(Offering o, Participant requester, String rfqId, String purpose, Instant at,
                               PolicyDecision.Stage stage, boolean record) {
        var provider = participants.findById(o.providerBpn).orElseThrow();
        ensure(OpaClient.REED, o.policyTemplate, offeringRego(o));
        var input = input(requester, provider, o, null, null, purpose, purpose, "use", at);
        var result = opa.evaluate(OpaClient.REED, o.policyTemplate, "eligibility", input);
        var subject = new Subject(requester.bpn, o.providerBpn, null, o.id, rfqId, o.assetId, "use", purpose);
        return outcome(stage, subject, result, opa.url(OpaClient.REED), record);
    }

    /** Turns OPA's result into an outcome and, if {@code record}, a row in the decision log. */
    public Outcome outcome(PolicyDecision.Stage stage, Subject s, JsonNode result, String decidedBy, boolean record) {
        var decision = result.path("decision").asText();
        if (!decision.equals("ALLOW") && !decision.equals("DENY")) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "not a policy decision: " + result);
        }
        var conditions = conditions(result.path("conditions"));
        var failed = conditions.stream().filter(c -> !c.pass()).toList();
        // ALLOW only if OPA said so AND nothing failed: a result that contradicts itself is a denial
        var verdict = decision.equals("ALLOW") && failed.isEmpty() && !conditions.isEmpty() ? "ALLOW" : "DENY";
        var explanation = verdict.equals("ALLOW")
                ? "ALLOW - " + conditions.stream().map(c -> c.label() + " ✓").collect(Collectors.joining("; "))
                : "DENY - " + failed.stream().map(c -> c.label() + " ✗").collect(Collectors.joining("; "));
        var d = new PolicyDecision();
        d.stage = stage.name();
        d.requesterBpn = s.requesterBpn();
        d.providerBpn = s.providerBpn();
        d.contractId = s.contractId();
        d.offeringId = s.offeringId();
        d.rfqId = s.rfqId();
        d.assetId = s.assetId();
        d.action = s.action();
        d.purpose = s.purpose();
        d.decision = verdict;
        d.policyId = result.path("policy").asText(null);
        d.decidedBy = decidedBy;
        d.explanation = explanation.length() > 2048 ? explanation.substring(0, 2048) : explanation;
        try {
            d.conditions = mapper.writeValueAsString(conditions);
            d.failed = mapper.writeValueAsString(failed);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        if (record) {
            decisions.save(d);
        }
        return new Outcome(d.id, d.stage, verdict, d.policyId, decidedBy, conditions, failed, d.explanation, d.at);
    }

    private static List<Condition> conditions(JsonNode array) {
        var out = new ArrayList<Condition>();
        for (var c : array) {
            // "pass" must be the boolean true; anything else (missing, a string) counts as failed
            out.add(new Condition(c.path("id").asText(), c.path("kind").asText(), c.path("label").asText(),
                    c.path("pass").isBoolean() && c.path("pass").asBoolean()));
        }
        return out;
    }

    public Outcome view(PolicyDecision d) {
        try {
            return new Outcome(d.id, d.stage, d.decision, d.policyId, d.decidedBy,
                    conditions(mapper.readTree(d.conditions == null ? "[]" : d.conditions)),
                    conditions(mapper.readTree(d.failed == null ? "[]" : d.failed)), d.explanation, d.at);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
