/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.edc;

import org.example.reed.config.ReedProperties;
import org.example.reed.domain.AssetClassification;
import org.example.reed.policy.PolicyTemplateRenderer;
import org.example.reed.repo.AssetClassificationRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Renders EDC Management API payloads (assets, policy definitions, contract
 * definitions) <em>from</em> the REED classification matrix + policy templates.
 * REED is the source of truth; {@code seed-reed.sh} POSTs these into the
 * connector.
 *
 * <p>The EDC policy bodies are deliberately permissive {@code Set} policies so
 * that contract negotiation succeeds under the demo's {@code iam-mock} (which
 * carries no verifiable BPN/role claims). The faithful, constraint-bearing
 * ODRL is attached to each asset under the {@code reed:odrl} property and is
 * also served by the REED policy-template API - that is what a production
 * DCP/IdentityHub deployment would actually enforce.
 */
@Service
public class EdcRenderService {

    private static final String EDC_VOCAB = "https://w3id.org/edc/v0.0.1/ns/";

    private final AssetClassificationRepository classifications;
    private final PolicyTemplateRepository templates;
    private final PolicyTemplateRenderer renderer;
    private final ReedProperties props;

    public EdcRenderService(AssetClassificationRepository classifications, PolicyTemplateRepository templates,
                            PolicyTemplateRenderer renderer, ReedProperties props) {
        this.classifications = classifications;
        this.templates = templates;
        this.renderer = renderer;
        this.props = props;
    }

    public List<Map<String, Object>> assets() {
        return classifications.findAll().stream().map(this::asset).toList();
    }

    public List<Map<String, Object>> policyDefinitions() {
        // One EDC policy per distinct template referenced by the matrix.
        return classifications.findAll().stream()
                .map(c -> c.defaultPolicyTemplate)
                .distinct()
                .map(this::policyDefinition)
                .toList();
    }

    public List<Map<String, Object>> contractDefinitions() {
        return classifications.findAll().stream().map(this::contractDefinition).toList();
    }

    private Map<String, Object> asset(AssetClassification c) {
        var assetId = c.assetClass.assetId();
        var faithfulOdrl = templates.findById(c.defaultPolicyTemplate)
                .map(t -> (Object) renderer.render(t, "*", props.getOwnerBpn(), assetId))
                .orElse(Map.of());

        var properties = new LinkedHashMap<String, Object>();
        properties.put("name", c.assetClass.title());
        properties.put("description", c.assetClass.description());
        properties.put("contenttype", "application/json");
        properties.put("reed:assetClass", c.assetClass.name());
        properties.put("reed:sensitivity", c.sensitivity.name());
        properties.put("reed:discoverability", c.discoverability.name());
        properties.put("reed:policyTemplate", c.defaultPolicyTemplate);
        properties.put("reed:ownerBpn", props.getOwnerBpn());
        properties.put("reed:odrl", faithfulOdrl);

        var dataAddress = new LinkedHashMap<String, Object>();
        dataAddress.put("type", "HttpData");
        dataAddress.put("name", assetId);
        dataAddress.put("baseUrl", "http://reed-backend:8080/reed/submodels/" + assetId);
        dataAddress.put("proxyPath", "false");
        dataAddress.put("proxyQueryParams", "false");
        // The proxy presents this static header to the submodel service.
        dataAddress.put("authKey", "X-Api-Key");
        dataAddress.put("authCode", props.getApiKey());

        var asset = new LinkedHashMap<String, Object>();
        asset.put("@context", Map.of("@vocab", EDC_VOCAB));
        asset.put("@id", assetId);
        asset.put("properties", properties);
        asset.put("dataAddress", dataAddress);
        return asset;
    }

    private Map<String, Object> policyDefinition(String templateName) {
        var policy = new LinkedHashMap<String, Object>();
        policy.put("@context", "http://www.w3.org/ns/odrl.jsonld");
        policy.put("@type", "Set");
        policy.put("permission", List.of());
        policy.put("prohibition", List.of());
        policy.put("obligation", List.of());

        var def = new LinkedHashMap<String, Object>();
        def.put("@context", List.of("https://w3id.org/edc/connector/management/v0.0.1",
                Map.of("@vocab", EDC_VOCAB)));
        def.put("@id", policyId(templateName));
        def.put("policy", policy);
        return def;
    }

    private Map<String, Object> contractDefinition(AssetClassification c) {
        var assetId = c.assetClass.assetId();
        var criterion = new LinkedHashMap<String, Object>();
        criterion.put("@type", "Criterion");
        criterion.put("operandLeft", EDC_VOCAB + "id");
        criterion.put("operator", "=");
        criterion.put("operandRight", assetId);

        var def = new LinkedHashMap<String, Object>();
        def.put("@context", Map.of("@vocab", EDC_VOCAB));
        def.put("@id", "reed-contract-" + c.assetClass.kebab());
        def.put("accessPolicyId", policyId(c.defaultPolicyTemplate));
        def.put("contractPolicyId", policyId(c.defaultPolicyTemplate));
        def.put("assetsSelector", List.of(criterion));
        return def;
    }

    private String policyId(String templateName) {
        return "reed-policy-" + templateName;
    }
}
