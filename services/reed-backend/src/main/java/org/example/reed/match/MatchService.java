/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.match;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.catalogue.AssetMetadata;
import org.example.reed.catalogue.CatalogueService;
import org.example.reed.domain.AssetClass;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.domain.MatchRecord;
import org.example.reed.domain.Participant;
import org.example.reed.domain.Rfq;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.edc.EdrStore;
import org.springframework.web.client.RestClient;
import org.example.reed.participant.CredentialVerifier;
import org.example.reed.participant.Roster;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.MatchRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.RfqRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.Set;

/**
 * Matchmaking: ranks suppliers for an RFQ (and RFQs for a supplier), recommends
 * partners for process steps the main supplier does not cover, and runs the
 * match lifecycle. Scoring itself is the pure {@link MatchScorer}; this class
 * only gathers inputs from the registry and enforces who may see what.
 */
@Service
public class MatchService {

    /** A ranked supplier as shown to a user: score result + directory info + lifecycle state. */
    public record RankedSupplier(int rank, MatchScorer.Result result, String country, String city,
                                 String connectorName, String did, String summary, Set<String> verifiedCerts,
                                 List<String> claimedCerts, String detailAssetId, Long matchId, String state) {
    }

    public record Partner(String process, List<RankedSupplier> candidates, List<AssetMetadata> visibleAssets) {
    }

    public record Opportunity(Rfq rfq, String buyerName, MatchScorer.Result result, Long matchId, String state) {
    }

    /** EDC ids are UUIDs or similar; anything else never reaches a connector URL. */
    private static final Pattern AGREEMENT_ID = Pattern.compile("[A-Za-z0-9:_.-]{1,128}");

    private final ParticipantRepository participants;
    private final RfqRepository rfqs;
    private final MatchRepository matches;
    private final AssetRepository assets;
    private final AuditEventRepository audit;
    private final CredentialVerifier credentials;
    private final CatalogueService catalogue;
    private final ConnectorClient connectors;
    private final ObjectMapper mapper;
    private final EdrStore edrs;
    private final MatchScorer scorer;
    private final Clock clock;

    public MatchService(ParticipantRepository participants, RfqRepository rfqs, MatchRepository matches,
                        AssetRepository assets, AuditEventRepository audit, CredentialVerifier credentials,
                        CatalogueService catalogue, ConnectorClient connectors, ObjectMapper mapper,
                        MatchScorer.Weights weights, Clock clock, EdrStore edrs) {
        this.participants = participants;
        this.rfqs = rfqs;
        this.matches = matches;
        this.assets = assets;
        this.audit = audit;
        this.credentials = credentials;
        this.catalogue = catalogue;
        this.connectors = connectors;
        this.mapper = mapper;
        this.scorer = new MatchScorer(weights);
        this.edrs = edrs;
        this.clock = clock;
    }

    // ---------------------------------------------------------------- ranking

    public List<RankedSupplier> rank(Rfq rfq) {
        var ranked = scorer.rank(demand(rfq), candidates(rfq.buyerBpn));
        var lifecycle = new LinkedHashMap<String, MatchRecord>();
        matches.findByRfqId(rfq.id).forEach(m -> lifecycle.put(m.supplierBpn, m));
        var out = new ArrayList<RankedSupplier>();
        for (int i = 0; i < ranked.size(); i++) {
            var r = ranked.get(i);
            out.add(view(r.qualified() ? i + 1 : 0, r, lifecycle.get(r.bpn())));
        }
        return out;
    }

    public List<Partner> partners(Rfq rfq, String viewerBpn) {
        var demand = demand(rfq);
        var pool = candidates(rfq.buyerBpn);
        var out = new ArrayList<Partner>();
        for (var process : nn(rfq.partnerProcesses)) {
            var ranked = scorer.rank(MatchScorer.partnerDemand(demand, process), pool).stream()
                    .filter(MatchScorer.Result::qualified).limit(3).toList();
            var views = new ArrayList<RankedSupplier>();
            for (int i = 0; i < ranked.size(); i++) {
                views.add(view(i + 1, ranked.get(i), null));
            }
            // Recommend the data assets of the best partner that the viewer is allowed to discover.
            var visible = ranked.isEmpty() ? List.<AssetMetadata>of()
                    : catalogue.visibleTo(viewerBpn).stream()
                    .filter(a -> a.ownerBpn().equals(ranked.get(0).bpn())).toList();
            out.add(new Partner(process, views, visible));
        }
        return out;
    }

    public List<Opportunity> opportunities(String supplierBpn) {
        var me = participant(supplierBpn);
        if (me.capability == null) {
            return List.of();
        }
        var self = toSupplier(me);
        var out = new ArrayList<Opportunity>();
        for (var rfq : rfqs.findByStateOrderByCreatedAtDesc(Rfq.State.OPEN)) {
            if (rfq.buyerBpn.equals(supplierBpn)) {
                continue;
            }
            var r = scorer.score(demand(rfq), self);
            if (r.qualified()) {
                var m = matches.findByRfqIdAndSupplierBpn(rfq.id, supplierBpn).orElse(null);
                out.add(new Opportunity(rfq, participants.findById(rfq.buyerBpn).map(p -> p.name).orElse(rfq.buyerBpn),
                        r, m == null ? null : m.id, m == null ? "PROPOSED" : m.state.name()));
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- lifecycle

    @Transactional
    public MatchRecord shortlist(Rfq rfq, String supplierBpn) {
        var existing = matches.findByRfqIdAndSupplierBpn(rfq.id, supplierBpn);
        if (existing.isPresent()) {
            return existing.get();
        }
        var result = scorer.score(demand(rfq), toSupplier(participant(supplierBpn)));
        if (!result.qualified()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, supplierBpn + " does not qualify for " + rfq.id);
        }
        var m = new MatchRecord(rfq.id, rfq.buyerBpn, supplierBpn, result.score(), json(result),
                MatchRecord.State.SHORTLISTED);
        m.detailAssetId = detailAssetId(supplierBpn);
        log(rfq.buyerBpn, m.detailAssetId, "shortlisted " + supplierBpn + " for " + rfq.id + " (score " + result.score() + ")");
        return matches.save(m);
    }

    @Transactional
    public MatchRecord respond(MatchRecord m, boolean accept) {
        expect(m, MatchRecord.State.SHORTLISTED);
        m.state = accept ? MatchRecord.State.ACCEPTED : MatchRecord.State.DECLINED;
        m.updatedAt = clock.instant();
        log(m.supplierBpn, m.detailAssetId, (accept ? "accepted" : "declined") + " match for " + m.rfqId + " from " + m.buyerBpn);
        return matches.save(m);
    }

    /**
     * Confirms a match once the buyer holds an EDC contract agreement for the
     * supplier's confidential ProcessCapability. The agreement is verified on
     * the buyer's own connector; then the confidential figures are checked
     * against the RFQ - a public claim the detail does not back up rejects the
     * match and counts against the supplier's track record.
     */
    // Not @Transactional: the confirmation waits for an EDC transfer, which must not hold a DB transaction.
    public MatchRecord confirm(MatchRecord m, String agreementId) {
        expect(m, MatchRecord.State.ACCEPTED);
        var buyer = participant(m.buyerBpn);
        var supplier = participant(m.supplierBpn);
        if (buyer.connectorName == null || supplier.connectorName == null || m.detailAssetId == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "both parties need an EDC connector to confirm via a contract agreement");
        }
        if (!AGREEMENT_ID.matcher(agreementId).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "malformed agreement id");
        }
        var agreement = readJson(connectors.get(buyer.connectorName, buyer.managementUrl,
                "/v4/contractagreements/" + agreementId));
        var assetId = text(agreement, "assetId");
        if (!m.detailAssetId.equals(assetId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "agreement " + agreementId + " covers asset " + assetId + ", expected " + m.detailAssetId);
        }
        var provider = text(agreement, "providerId");
        var consumer = text(agreement, "consumerId");
        if (!Objects.equals(provider, supplier.did) || !Objects.equals(consumer, buyer.did)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "agreement " + agreementId + " is between "
                    + consumer + " and " + provider + ", not between this buyer and supplier");
        }
        m.agreementId = agreementId;
        var contradictions = contradictions(rfqs.findById(m.rfqId).orElseThrow(), pullDetail(buyer, supplier, agreementId));
        if (contradictions.isEmpty()) {
            m.state = MatchRecord.State.CONFIRMED;
            m.note = "EDC agreement " + agreementId + " verified; confidential capability confirms the claim";
            rfqs.findById(m.rfqId).ifPresent(r -> {
                r.state = Rfq.State.AWARDED;
                rfqs.save(r);
            });
        } else {
            m.state = MatchRecord.State.REJECTED;
            m.note = "CLAIM_NOT_CONFIRMED: " + String.join("; ", contradictions);
        }
        m.updatedAt = clock.instant();
        log(m.buyerBpn, m.detailAssetId, m.state + " match " + m.id + " for " + m.rfqId + " - " + m.note);
        return matches.save(m);
    }

    @Transactional
    public MatchRecord feedback(MatchRecord m, boolean onTime, boolean qualityOk) {
        expect(m, MatchRecord.State.CONFIRMED);
        m.onTime = onTime;
        m.qualityOk = qualityOk;
        m.updatedAt = clock.instant();
        log(m.buyerBpn, null, "feedback for " + m.supplierBpn + " on " + m.rfqId + ": onTime=" + onTime + " qualityOk=" + qualityOk);
        return matches.save(m);
    }

    // ---------------------------------------------------------------- inputs

    MatchScorer.Demand demand(Rfq rfq) {
        var buyer = participants.findById(rfq.buyerBpn).orElse(null);
        var weeks = Math.max(1, ChronoUnit.DAYS.between(LocalDate.now(clock), rfq.dueDate) / 7.0);
        return new MatchScorer.Demand(rfq.id, rfq.sector, blankToNull(rfq.material), rfq.dimsMm, rfq.massKg, rfq.tolMm,
                rfq.quantity, weeks, nn(rfq.requiredProcesses), nn(rfq.requiredCerts),
                rfq.deliveryLat != null ? rfq.deliveryLat : buyer == null ? 0 : buyer.lat,
                rfq.deliveryLon != null ? rfq.deliveryLon : buyer == null ? 0 : buyer.lon);
    }

    private List<MatchScorer.Supplier> candidates(String buyerBpn) {
        return participants.findAll().stream()
                .filter(p -> p.consortium && p.capability != null && !p.bpn.equals(buyerBpn))
                .map(this::toSupplier)
                .toList();
    }

    private MatchScorer.Supplier toSupplier(Participant p) {
        var history = matches.findBySupplierBpn(p.bpn);
        var good = (int) history.stream().filter(m -> Boolean.TRUE.equals(m.onTime) && Boolean.TRUE.equals(m.qualityOk)).count();
        var total = (int) history.stream().filter(m -> m.onTime != null
                || (m.state == MatchRecord.State.REJECTED && m.note != null && m.note.startsWith("CLAIM_NOT_CONFIRMED"))).count();
        return new MatchScorer.Supplier(p.bpn, p.name, p.lat, p.lon, p.portAccess, p.railAccess, nn(p.sectors),
                p.capability, credentials.verifiedCerts(p), good, total);
    }

    /** Same mapping from the roster file, for tests and fixtures (no database). */
    public static MatchScorer.Supplier fromSpec(Roster.ParticipantSpec p) {
        var good = (int) p.history().stream().filter(h -> h.onTime() && h.qualityOk()).count();
        return new MatchScorer.Supplier(p.bpn(), p.name(), p.lat(), p.lon(), p.portAccess(), p.railAccess(),
                p.sectors(), p.capability(), new HashSet<>(p.attestations()), good, p.history().size());
    }

    public static MatchScorer.Demand demandFromSpec(Roster.RfqSpec r, double buyerLat, double buyerLon) {
        return new MatchScorer.Demand(r.id(), r.sector(), r.material(), r.dimsMm(), r.massKg(), r.tolMm(),
                r.quantity(), r.dueInWeeks(), r.requiredProcesses(), r.requiredCerts(),
                r.deliveryLat() != null ? r.deliveryLat() : buyerLat,
                r.deliveryLon() != null ? r.deliveryLon() : buyerLon);
    }

    // ---------------------------------------------------------------- helpers

    private RankedSupplier view(int rank, MatchScorer.Result r, MatchRecord m) {
        var p = participants.findById(r.bpn()).orElseThrow();
        return new RankedSupplier(rank, r, p.country, p.city, p.connectorName, p.did,
                p.capability == null ? null : p.capability.summary(), credentials.verifiedCerts(p),
                p.capability == null ? List.of() : p.capability.claimedCerts(), detailAssetId(p.bpn),
                m == null ? null : m.id, m == null ? (r.qualified() ? "PROPOSED" : "FILTERED") : m.state.name());
    }

    private String detailAssetId(String bpn) {
        return assets.findFirstByOwnerBpnAndAssetClass(bpn, AssetClass.ProcessCapability).map(a -> a.assetId).orElse(null);
    }

    /**
     * Pulls the supplier's confidential capability the way the buyer would: a transfer on the buyer's own
     * connector under the agreement, the EDR delivered by callback, then a GET on the supplier's data
     * plane. REED acts here as the buyer's agent; the payload is checked, never stored.
     */
    private JsonNode pullDetail(Participant buyer, Participant supplier, String agreementId) {
        try {
            var request = mapper.writeValueAsString(Map.of(
                    "@context", List.of("https://w3id.org/edc/connector/management/v2"), "@type", "TransferRequest",
                    "counterPartyAddress", supplier.dspUrl, "protocol", "dataspace-protocol-http:2025-1",
                    "contractId", agreementId, "transferType", "HttpData-PULL"));
            request = connectors.withServerCallbacks(buyer.connectorName, request, true);
            var tp = readJson(connectors.post(buyer.connectorName, buyer.managementUrl, "/v4/transferprocesses", request))
                    .path("@id").asText();
            EdrStore.Edr edr = null;
            for (int i = 0; i < 60 && edr == null; i++) {
                edr = edrs.get(buyer.connectorName, tp).orElse(null);
                if (edr == null) {
                    Thread.sleep(500);
                }
            }
            if (edr == null) {
                return null;
            }
            // Never fetch the URL the EDR names: build it from the registry (the supplier's own connector,
            // its public data-plane port) and take only the /public/... path from the EDR.
            var path = java.net.URI.create(edr.endpoint()).getRawPath();
            var mgmt = java.net.URI.create(supplier.managementUrl);
            var prefix = String.valueOf(mgmt.getPort()).substring(0, 2);
            if (path == null || !path.startsWith("/public/") || path.contains("..")) {
                return null;
            }
            var internal = mgmt.getScheme() + "://" + supplier.connectorName + ":" + prefix + "291" + path;
            return readJson(RestClient.create().get().uri(internal).header("Authorization", edr.authorization())
                    .retrieve().body(String.class));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Hard-filter checks of the RFQ against the supplier's confidential (contracted) capability. */
    private List<String> contradictions(Rfq rfq, JsonNode payload) {
        var out = new ArrayList<String>();
        if (payload == null) {
            out.add("confidential capability could not be retrieved over EDC");
            return out;
        }
        var env = payload.path("envelopeMm");
        if (env.isArray() && env.size() == 3) {
            var e = List.of(env.get(0).asInt(), env.get(1).asInt(), env.get(2).asInt());
            if (!MatchScorer.fits(rfq.dimsMm, e)) {
                out.add("actual envelope " + e + " mm is too small");
            }
        }
        if (payload.hasNonNull("maxMassKg") && rfq.massKg > payload.get("maxMassKg").asDouble()) {
            out.add("actual mass limit " + payload.get("maxMassKg").asDouble() / 1000 + " t");
        }
        if (rfq.tolMm != null && payload.hasNonNull("bestTolMm") && payload.get("bestTolMm").asDouble() > rfq.tolMm) {
            out.add("actual best tolerance ±" + payload.get("bestTolMm").asDouble() + " mm");
        }
        return out;
    }

    private Participant participant(String bpn) {
        return participants.findById(bpn)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown participant " + bpn));
    }

    private static void expect(MatchRecord m, MatchRecord.State state) {
        if (m.state != state) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "match " + m.id + " is " + m.state + ", expected " + state);
        }
    }

    private void log(String actor, String assetId, String detail) {
        audit.save(new AuditEvent(EventType.MATCH, actor, assetId, detail));
    }

    private String json(Object o) {
        try {
            return mapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private JsonNode readJson(String s) {
        try {
            return mapper.readTree(s);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "unparseable JSON", e);
        }
    }

    private static String text(JsonNode n, String field) {
        var v = n.has(field) ? n.get(field) : n.path("edc:" + field);
        if (v.isMissingNode()) {
            v = n.path("https://w3id.org/edc/v0.0.1/ns/" + field);
        }
        return v.isTextual() ? v.asText() : v.path("@value").asText(v.asText());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static <T> List<T> nn(List<T> l) {
        return l == null ? List.of() : l;
    }
}
