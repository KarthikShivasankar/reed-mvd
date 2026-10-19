/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.seed;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.config.ReedProperties;
import org.example.reed.domain.Asset;
import org.example.reed.domain.AssetClass;
import org.example.reed.domain.AssetClassification;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.Discoverability;
import org.example.reed.domain.EventType;
import org.example.reed.domain.MatchRecord;
import org.example.reed.domain.Participant;
import org.example.reed.domain.PolicyTemplate;
import org.example.reed.domain.RelationType;
import org.example.reed.domain.Rfq;
import org.example.reed.domain.Sensitivity;
import org.example.reed.domain.SupplyChainRelation;
import org.example.reed.participant.Roster;
import org.example.reed.repo.AssetClassificationRepository;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.MatchRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.example.reed.repo.RfqRepository;
import org.example.reed.repo.SupplyChainRelationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Path;
import java.time.Clock;
import java.time.LocalDate;

/**
 * Seeds REED reference data on startup (idempotent - each block runs only on
 * an empty table): the policy templates, the classification matrix, and - from
 * {@code deployment/roster.json} and {@code deployment/scenarios/matchmaking.json}
 * - the participant directory, every participant's assets, the supply-chain
 * graph, delivery history and the open RFQs of the real-case scenarios.
 */
@Component
public class DataSeeder implements CommandLineRunner {

    private static final Logger LOG = LoggerFactory.getLogger(DataSeeder.class);

    private final PolicyTemplateRepository templates;
    private final AssetClassificationRepository classifications;
    private final SupplyChainRelationRepository relations;
    private final AuditEventRepository audit;
    private final ParticipantRepository participants;
    private final AssetRepository assets;
    private final RfqRepository rfqs;
    private final MatchRepository matches;
    private final ReedProperties props;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final String didPattern;

    public DataSeeder(PolicyTemplateRepository templates, AssetClassificationRepository classifications,
                      SupplyChainRelationRepository relations, AuditEventRepository audit,
                      ParticipantRepository participants, AssetRepository assets, RfqRepository rfqs,
                      MatchRepository matches, ReedProperties props, ObjectMapper mapper, Clock clock,
                      @Value("${reed.did-pattern}") String didPattern) {
        this.templates = templates;
        this.classifications = classifications;
        this.relations = relations;
        this.audit = audit;
        this.participants = participants;
        this.assets = assets;
        this.rfqs = rfqs;
        this.matches = matches;
        this.props = props;
        this.mapper = mapper;
        this.clock = clock;
        this.didPattern = didPattern;
    }

    @Override
    @Transactional
    public void run(String... args) throws Exception {
        seedPolicyTemplates();
        seedClassificationMatrix();
        var dir = Path.of(props.getDeploymentDir());
        var roster = Roster.load(mapper, dir.resolve("roster.json"));
        seedParticipants(roster);
        seedRfqs(roster, Roster.loadScenarios(mapper, dir.resolve("scenarios/matchmaking.json")));
    }

    private void seedPolicyTemplates() {
        if (templates.count() > 0) {
            return;
        }
        LOG.info("REED seed: policy templates");
        // Permission constraints use credential-backed left operands the EDC connectors evaluate
        // against the requester's verifiable credentials (DCP). Prohibitions, obligations and
        // expiry are the usage layer: carried as reed:odrl and enforced/audited REED-side.
        templates.save(new PolicyTemplate("consortium-only",
                "Any REED consortium member (valid MembershipCredential) may use the data.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"MembershipCredential\",\"operator\":\"eq\",\"rightOperand\":\"active\"}]}],"
                        + "\"prohibition\":[],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("bilateral-supplier",
                "Only a partner with a supply relation to the owner (SupplierRelationCredential) may use the data; no redistribution.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"SupplierRelationCredential.partner\",\"operator\":\"eq\",\"rightOperand\":\"$OWNER_BPN\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"}],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("dpp-read-only",
                "Read-only access to the digital product passport (ESPR) for members; no modification or redistribution.",
                "{\"permission\":[{\"action\":\"read\",\"constraint\":[{\"leftOperand\":\"MembershipCredential\",\"operator\":\"eq\",\"rightOperand\":\"active\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"},{\"action\":\"modify\"}],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("oem-only",
                "Only members holding the OEM role may use the data; no redistribution.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"MembershipCredential.role\",\"operator\":\"eq\",\"rightOperand\":\"OEM\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"}],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("time-limited-pilot-access",
                "Members of a shared project may use the data until the pilot expiry; data must be deleted afterwards.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"SupplierRelationCredential.project\",\"operator\":\"eq\",\"rightOperand\":\"$OWNER_BPN\"},{\"leftOperand\":\"odrl:dateTime\",\"operator\":\"lteq\",\"rightOperand\":\"$EXPIRY\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"}],\"obligation\":[{\"action\":\"delete\",\"constraint\":[{\"leftOperand\":\"odrl:dateTime\",\"operator\":\"gt\",\"rightOperand\":\"$EXPIRY\"}]}]}"));
        templates.save(new PolicyTemplate("simulation-service-only",
                "Only accredited service providers (SERVICE role) may use the data; no redistribution or derivation.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"MembershipCredential.role\",\"operator\":\"eq\",\"rightOperand\":\"SERVICE\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"},{\"action\":\"derive\"}],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
    }

    private void seedClassificationMatrix() {
        if (classifications.count() > 0) {
            return;
        }
        LOG.info("REED seed: classification matrix (8 asset classes)");
        classify(AssetClass.PartDigitalTwin, Sensitivity.consortium, Discoverability.consortium, "consortium-only");
        classify(AssetClass.BillOfMaterial, Sensitivity.confidential, Discoverability.bilateral, "bilateral-supplier");
        classify(AssetClass.DigitalProductPassport, Sensitivity.consortium, Discoverability.consortium, "dpp-read-only");
        classify(AssetClass.ProcessCapability, Sensitivity.confidential, Discoverability.bilateral, "oem-only");
        classify(AssetClass.FixtureHandlingStrategy, Sensitivity.confidential, Discoverability.bilateral, "bilateral-supplier");
        classify(AssetClass.ProductionStatus, Sensitivity.restricted, Discoverability.project, "time-limited-pilot-access");
        classify(AssetClass.QualityEvidence, Sensitivity.regulated, Discoverability.bilateral, "oem-only");
        classify(AssetClass.SimulationResult, Sensitivity.confidential, Discoverability.bilateral, "simulation-service-only");
    }

    private void classify(AssetClass clazz, Sensitivity sensitivity, Discoverability discoverability, String template) {
        classifications.save(new AssetClassification(clazz, sensitivity, discoverability, template));
        audit.save(new AuditEvent(EventType.CLASSIFY, null, clazz.kebab(),
                "classified " + clazz + " as " + sensitivity + "/" + discoverability + " -> " + template));
    }

    private void seedParticipants(Roster.File roster) throws Exception {
        if (participants.count() > 0) {
            return;
        }
        LOG.info("REED seed: {} participants from roster", roster.participants().size());
        for (var spec : roster.participants()) {
            var p = new Participant(spec.bpn());
            p.name = spec.name();
            p.shortName = spec.shortName();
            p.role = spec.role();
            p.consortium = spec.member();
            p.illustrative = Boolean.TRUE.equals(spec.illustrative());
            p.country = spec.country();
            p.city = spec.city();
            p.vatId = spec.vatId();
            p.lat = spec.lat();
            p.lon = spec.lon();
            p.portAccess = spec.portAccess();
            p.railAccess = spec.railAccess();
            p.sectors = spec.sectors();
            p.attestations = spec.attestations();
            p.capability = spec.capability();
            if (spec.connector() != null) {
                var name = spec.connector().name();
                var prefix = spec.connector().portPrefix();
                p.connectorName = name;
                p.dspUrl = "https://" + name + ":" + prefix + "194/protocol/2025-1";
                p.managementUrl = "https://" + name + ":" + prefix + "193/management";
                p.did = didPattern.replace("{name}", name);
            } else if (spec.identity() != null) {
                // Identity-only member (e.g. the operator running the federated catalog).
                p.did = didPattern.replace("{name}", spec.identity());
            }
            participants.save(p);

            for (var cls : spec.assets()) {
                seedAsset(spec, AssetClass.valueOf(cls));
            }
            for (var r : spec.relations()) {
                // Edges point from the buyer/OEM (parent) to the supplier/member (child).
                relations.save(new SupplyChainRelation(r.to(), spec.bpn(), RelationType.valueOf(r.type())));
            }
            int i = 0;
            for (var h : spec.history()) {
                var m = new MatchRecord("HIST-" + spec.bpn() + "-" + (++i), h.buyer(), spec.bpn(), 0, null,
                        MatchRecord.State.CONFIRMED);
                m.onTime = h.onTime();
                m.qualityOk = h.qualityOk();
                m.note = "historical delivery (seeded)";
                matches.save(m);
            }
        }
    }

    private void seedAsset(Roster.ParticipantSpec owner, AssetClass cls) {
        var c = classifications.findById(cls).orElseThrow();
        var a = new Asset(cls.kebab() + "-" + owner.connector().name(), cls, owner.bpn());
        a.title = cls.title() + " - " + owner.shortName();
        a.description = cls.description();
        a.sensitivity = c.sensitivity;
        a.discoverability = c.discoverability;
        a.policyTemplate = c.defaultPolicyTemplate;

        if (cls == AssetClass.ProcessCapability && owner.confidentialCapability() != null) {
            // A supplier's detailed capability: discoverable to all members (so buyers can find
            // and negotiate it during matchmaking), but only OEMs may contract for it. The payload
            // itself is held by the supplier's own data service (written by tools/gen_topology.py).
            a.discoverability = Discoverability.consortium;
            a.description = "Confidential detail behind the public capability claim: " + owner.capability().summary();
        }
        assets.save(a);
    }

    private void seedRfqs(Roster.File roster, Roster.Scenarios scenarios) {
        if (rfqs.count() > 0) {
            return;
        }
        LOG.info("REED seed: {} scenario RFQs", scenarios.rfqs().size());
        for (var s : scenarios.rfqs()) {
            var r = new Rfq();
            r.id = s.id();
            r.buyerBpn = s.buyer();
            r.title = s.title();
            r.story = s.story();
            r.sector = s.sector();
            r.partFamily = s.partFamily();
            r.material = s.material();
            r.dimsMm = s.dimsMm();
            r.massKg = s.massKg();
            r.tolMm = s.tolMm();
            r.quantity = s.quantity();
            r.dueDate = LocalDate.now(clock).plusWeeks(s.dueInWeeks());
            r.deliveryLat = s.deliveryLat();
            r.deliveryLon = s.deliveryLon();
            r.requiredProcesses = s.requiredProcesses();
            r.requiredCerts = s.requiredCerts();
            r.partnerProcesses = s.partnerProcesses();
            rfqs.save(r);
            audit.save(new AuditEvent(EventType.MATCH, s.buyer(), null, "RFQ " + s.id() + " posted: " + s.title()));
        }
    }
}
