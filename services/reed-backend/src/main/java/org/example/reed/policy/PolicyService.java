/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.domain.Asset;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.Discoverability;
import org.example.reed.domain.EventType;
import org.example.reed.domain.Participant;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.edc.EdcRenderService;
import org.example.reed.policy.PolicyEvaluator.Claims;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Data sovereignty in practice: an owner sees, for each of its assets, which company would find it and which
 * would get a contract - and why, credential by credential - and changes its terms, which REED republishes to
 * the owner's own connector at once. Only the owner sets its terms; the dataspace operator only looks.
 */
@Service
public class PolicyService {

    /** One requester's outcome for one asset. */
    public record Access(String bpn, String company, String connector, String country, String role,
                         boolean visible, String discoverReason, boolean granted, String contractReason) {
    }

    /** An asset's terms in words and who gets what. */
    public record AssetAccess(String assetId, String title, String assetClass, String sensitivity, String ownerBpn,
                              String discoverability, String policyTemplate, List<String> discoverTerms,
                              List<String> contractTerms, List<Access> access) {
    }

    public record Change(String discoverability, String policyTemplate) {
    }

    /** Another owner's asset as one requester may see it: only what its credentials let it discover. */
    public record Offer(String assetId, String title, String assetClass, String sensitivity, String ownerBpn, String owner,
                        String ownerConnector, String ownerCountry, String policyTemplate, List<String> contractTerms,
                        boolean granted, String reason) {
    }

    /** A requester's credentials (as the issuer issues them) and what it can get with them. */
    public record Inbound(Claims claims, List<Offer> offers) {
    }

    private final AssetRepository assets;
    private final ParticipantRepository participants;
    private final PolicyTemplateRepository templates;
    private final EdcRenderService render;
    private final ConnectorClient connectors;
    private final AuditEventRepository audit;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public PolicyService(AssetRepository assets, ParticipantRepository participants, PolicyTemplateRepository templates,
                         EdcRenderService render, ConnectorClient connectors, AuditEventRepository audit,
                         JdbcTemplate jdbc, ObjectMapper mapper) {
        this.assets = assets;
        this.participants = participants;
        this.templates = templates;
        this.render = render;
        this.connectors = connectors;
        this.audit = audit;
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /** Every asset of {@code owner} with who-gets-what under its current terms. */
    public List<AssetAccess> access(String owner) {
        var claims = claims();
        var requesters = requesters();
        var name = names();
        return assets.findByOwnerBpnOrderByAssetId(owner).stream()
                .map(a -> evaluate(a, a.discoverability, a.policyTemplate, requesters, claims, name)).toList();
    }

    /**
     * What {@code requester} can discover from every other owner, and whether it would get a contract. Assets its
     * credentials do not let it discover are left out entirely - their existence is the owner's business.
     */
    public Inbound inbound(String requester) {
        var claims = claims().getOrDefault(requester, Claims.NONE);
        var name = names();
        var byBpn = participants.findAll().stream().collect(Collectors.toMap(p -> p.bpn, p -> p));
        var offers = new ArrayList<Offer>();
        for (var owner : requesters()) {
            if (owner.bpn.equals(requester)) {
                continue;
            }
            for (var a : assets.findByOwnerBpnOrderByAssetId(owner.bpn)) {
                if (!PolicyEvaluator.evaluate(EdcRenderService.access(a.discoverability, a.ownerBpn), claims, name).allowed()) {
                    continue;
                }
                var contract = render.contract(a.policyTemplate, a.ownerBpn);
                var d = PolicyEvaluator.evaluate(contract, claims, name);
                var o = byBpn.get(a.ownerBpn);
                offers.add(new Offer(a.assetId, a.title, a.assetClass.name(), a.sensitivity.name(), a.ownerBpn, o.shortName,
                        o.connectorName, o.country, a.policyTemplate,
                        contract.stream().map(k -> PolicyEvaluator.describe(k, name)).toList(), d.allowed(), d.reason()));
            }
        }
        return new Inbound(claims, offers);
    }

    /** What would happen under other terms, without publishing anything. */
    public AssetAccess preview(String assetId, String discoverability, String template) {
        var a = asset(assetId);
        return evaluate(a, discoverability(discoverability), template(template), requesters(), claims(), names());
    }

    /** The operator's view: every connector-owned asset against every other connector company. */
    public List<AssetAccess> matrix() {
        var claims = claims();
        var requesters = requesters();
        var name = names();
        return requesters.stream().flatMap(owner -> assets.findByOwnerBpnOrderByAssetId(owner.bpn).stream())
                .map(a -> evaluate(a, a.discoverability, a.policyTemplate, requesters, claims, name)).toList();
    }

    /**
     * The owner changes an asset's terms: stored in REED, then published to the owner's connector (access and
     * contract policy definitions, the asset's faithful ODRL, the contract definition). Agreements already signed
     * keep the terms they were signed under; the next catalogue request and negotiation see the new ones.
     */
    @Transactional
    public AssetAccess change(String actorBpn, String username, String assetId, Change c) {
        var a = asset(assetId);
        if (!a.ownerBpn.equals(actorBpn)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only the owner sets the terms of its data");
        }
        var d = discoverability(c.discoverability());
        var t = template(c.policyTemplate());
        var before = a.discoverability + "/" + a.policyTemplate;
        a.discoverability = d;
        a.policyTemplate = t;
        assets.save(a);

        var owner = participants.findById(a.ownerBpn).orElseThrow();
        if (owner.connectorName == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "the owner has no connector to publish to");
        }
        upsert(owner, "/v4/policydefinitions", render.accessPolicyDefinition(d, a.ownerBpn));
        upsert(owner, "/v4/policydefinitions", render.contractPolicyDefinition(t, a.ownerBpn));
        upsert(owner, "/v4/assets", render.asset(a));
        upsert(owner, "/v4/contractdefinitions", render.contractDefinition(a));
        audit.save(new AuditEvent(EventType.POLICY, actorBpn, a.assetId, username + " changed the terms of " + a.assetId
                + " from " + before + " to " + d + "/" + t + " and published them to connector " + owner.connectorName));
        return evaluate(a, d, t, requesters(), claims(), names());
    }

    /** POST, or PUT if it exists (policy definitions are updated by id, assets and contract definitions by body). */
    private void upsert(Participant owner, String path, Map<String, Object> body) {
        String json;
        try {
            json = mapper.writeValueAsString(body);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        var res = connectors.exchange(owner.connectorName, owner.managementUrl, HttpMethod.POST, path, json);
        if (res.getStatusCode().value() == 409) {
            var put = path.equals("/v4/policydefinitions") ? path + "/" + body.get("@id") : path;
            res = connectors.exchange(owner.connectorName, owner.managementUrl, HttpMethod.PUT, put, json);
        }
        if (!res.getStatusCode().is2xxSuccessful()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "connector " + owner.connectorName + " answered "
                    + res.getStatusCode() + " for " + path + ": " + res.getBody());
        }
    }

    private AssetAccess evaluate(Asset a, Discoverability d, String template, List<Participant> requesters,
                                 Map<String, Claims> claims, Function<String, String> name) {
        var discover = EdcRenderService.access(d, a.ownerBpn);
        var contract = render.contract(template, a.ownerBpn);
        var rows = new ArrayList<Access>();
        for (var p : requesters) {
            if (p.bpn.equals(a.ownerBpn)) {
                continue;
            }
            var c = claims.getOrDefault(p.bpn, Claims.NONE);
            var seen = PolicyEvaluator.evaluate(discover, c, name);
            var got = seen.allowed() ? PolicyEvaluator.evaluate(contract, c, name)
                    : new PolicyEvaluator.Decision(false, "cannot find it, so cannot ask for it");
            rows.add(new Access(p.bpn, p.shortName, p.connectorName, p.country, p.role, seen.allowed(), seen.reason(),
                    got.allowed(), got.reason()));
        }
        return new AssetAccess(a.assetId, a.title, a.assetClass.name(), a.sensitivity.name(), a.ownerBpn, d.name(), template,
                discover.stream().map(k -> PolicyEvaluator.describe(k, name)).toList(),
                contract.stream().map(k -> PolicyEvaluator.describe(k, name)).toList(), rows);
    }

    /** Companies that can ask: they run a connector. */
    private List<Participant> requesters() {
        return participants.findAll().stream().filter(p -> p.connectorName != null).toList();
    }

    private Function<String, String> names() {
        var m = participants.findAll().stream().collect(Collectors.toMap(p -> p.bpn, p -> p.shortName));
        return bpn -> m.getOrDefault(bpn, bpn);
    }

    /** The claims the issuer puts into each holder's credentials: the same views, so the same values. */
    private Map<String, Claims> claims() {
        var out = new HashMap<String, Claims>();
        jdbc.query("""
                SELECT m.bpn, m.role, m.country, c.certifications, r.partners, r.projects
                FROM vc_membership m JOIN vc_certification c ON c.bpn = m.bpn JOIN vc_supplier_relation r ON r.bpn = m.bpn""",
                rs -> {
                    out.put(rs.getString("bpn"), new Claims(true, rs.getString("role"), rs.getString("country"),
                            set(rs.getString("certifications")), set(rs.getString("partners")), set(rs.getString("projects"))));
                });
        return out;
    }

    /** ",A,B," -> {A, B} */
    private static Set<String> set(String delimited) {
        return delimited == null ? Set.of()
                : Arrays.stream(delimited.split(",")).filter(s -> !s.isBlank()).collect(Collectors.toSet());
    }

    private Asset asset(String assetId) {
        return assets.findById(assetId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown asset " + assetId));
    }

    private static Discoverability discoverability(String d) {
        try {
            return Discoverability.valueOf(d);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "discoverability must be one of "
                    + Arrays.toString(Discoverability.values()));
        }
    }

    private String template(String t) {
        if (t == null || !templates.existsById(t)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown policy template " + t);
        }
        return t;
    }
}
