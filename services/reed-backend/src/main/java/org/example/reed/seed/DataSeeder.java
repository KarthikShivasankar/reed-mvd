/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.seed;

import org.example.reed.config.Bpns;
import org.example.reed.domain.AssetClass;
import org.example.reed.domain.AssetClassification;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.Discoverability;
import org.example.reed.domain.EventType;
import org.example.reed.domain.PolicyTemplate;
import org.example.reed.domain.RelationType;
import org.example.reed.domain.Sensitivity;
import org.example.reed.domain.SupplyChainRelation;
import org.example.reed.repo.AssetClassificationRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.example.reed.repo.SupplyChainRelationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/**
 * Seeds the REED reference data on startup (idempotent): the six policy
 * templates, the eight-row classification matrix, the demo supply-chain graph,
 * and a {@code CLASSIFY} audit event per asset class.
 */
@Component
public class DataSeeder implements CommandLineRunner {

    private static final Logger LOG = LoggerFactory.getLogger(DataSeeder.class);

    private final PolicyTemplateRepository templates;
    private final AssetClassificationRepository classifications;
    private final SupplyChainRelationRepository relations;
    private final AuditEventRepository audit;

    public DataSeeder(PolicyTemplateRepository templates, AssetClassificationRepository classifications,
                      SupplyChainRelationRepository relations, AuditEventRepository audit) {
        this.templates = templates;
        this.classifications = classifications;
        this.relations = relations;
        this.audit = audit;
    }

    @Override
    public void run(String... args) {
        seedPolicyTemplates();
        seedClassificationMatrix();
        seedSupplyChain();
    }

    private void seedPolicyTemplates() {
        if (templates.count() > 0) {
            return;
        }
        LOG.info("REED seed: policy templates");
        // The audit obligation "reed:audit" is attached to every template so the
        // usage layer always records access. BPN / role / time constraints are
        // the faithful (DCP-enforceable) semantics; see PolicyTemplateRenderer.
        templates.save(new PolicyTemplate("consortium-only",
                "Any consortium member may use the data.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"reed:membership\",\"operator\":\"eq\",\"rightOperand\":\"consortium\"}]}],"
                        + "\"prohibition\":[],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("bilateral-supplier",
                "Only a partner with a direct supply relation to the owner may use the data; no redistribution.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"reed:supplyRelation\",\"operator\":\"eq\",\"rightOperand\":\"$REQUESTER_BPN\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"}],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("dpp-read-only",
                "Read-only access to the digital product passport; no modification or redistribution.",
                "{\"permission\":[{\"action\":\"read\"}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"},{\"action\":\"modify\"}],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("oem-only",
                "Only the OEM partner may use the data; no redistribution.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"reed:role\",\"operator\":\"eq\",\"rightOperand\":\"OEM\"},{\"leftOperand\":\"BusinessPartnerNumber\",\"operator\":\"eq\",\"rightOperand\":\"$REQUESTER_BPN\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"}],\"obligation\":[{\"action\":\"reed:audit\"}]}"));
        templates.save(new PolicyTemplate("time-limited-pilot-access",
                "Project members may use the data until the pilot expiry; data must be deleted afterwards.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"reed:project\",\"operator\":\"isPartOf\",\"rightOperand\":\"$REQUESTER_BPN\"},{\"leftOperand\":\"odrl:dateTime\",\"operator\":\"lteq\",\"rightOperand\":\"$EXPIRY\"}]}],"
                        + "\"prohibition\":[{\"action\":\"distribute\"}],\"obligation\":[{\"action\":\"delete\",\"constraint\":[{\"leftOperand\":\"odrl:dateTime\",\"operator\":\"gt\",\"rightOperand\":\"$EXPIRY\"}]}]}"));
        templates.save(new PolicyTemplate("simulation-service-only",
                "Only an accredited simulation service may use the data; no redistribution or derivation.",
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"reed:role\",\"operator\":\"eq\",\"rightOperand\":\"simulation-service\"}]}],"
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
        audit.save(new AuditEvent(EventType.CLASSIFY, Bpns.OEM, clazz.assetId(),
                "classified " + clazz + " as " + sensitivity + "/" + discoverability + " -> " + template));
    }

    private void seedSupplyChain() {
        if (relations.count() > 0) {
            return;
        }
        LOG.info("REED seed: supply-chain relations");
        // SUPPLIER supplies the OEM -> can discover bilateral assets owned by the OEM.
        relations.save(new SupplyChainRelation(Bpns.OEM, Bpns.SUPPLIER, RelationType.SUPPLIES));
        relations.save(new SupplyChainRelation(Bpns.OEM, Bpns.SUPPLIER, RelationType.OWNS));
        // SIM_SERVICE shares a project with the OEM -> can discover project-scoped assets.
        relations.save(new SupplyChainRelation(Bpns.OEM, Bpns.SIM_SERVICE, RelationType.PROJECT_MEMBER));
        // OUTSIDER is a consortium member but has no direct relation -> consortium-only.
    }
}
