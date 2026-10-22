/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.edc;

import com.fasterxml.jackson.databind.JsonNode;
import org.example.reed.config.ReedProperties;
import org.example.reed.domain.Asset;
import org.example.reed.domain.Discoverability;
import org.example.reed.policy.PolicyEvaluator;
import org.example.reed.policy.PolicyTemplateRenderer;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Renders EDC Management API v4 payloads (assets, policy definitions, contract
 * definitions; CEL expressions for v5beta) for <em>one owner's</em> connector from the REED tables.
 * All use the {@code management/v2} JSON-LD context with an explicit {@code @type}, as v4 requires. REED is
 * the source of truth; {@code seed-reed.sh} loops over every participant with a
 * connector and POSTs these into its Management API.
 *
 * <p>Two policies per contract definition, mirroring the REED layers:
 * <ul>
 *   <li><b>access policy</b> (catalogue layer) - one per discoverability value:
 *       consortium membership, a supply relation with the owner, or a shared
 *       project. Under DCP the provider's catalog simply omits offers the
 *       requester's credentials do not satisfy.</li>
 *   <li><b>contract policy</b> (contract layer) - the asset's policy template,
 *       e.g. "OEM role only" or "membership".</li>
 * </ul>
 * Constraints use credential-backed left operands that the connectors evaluate
 * against the requester's verifiable credentials. Usage-layer duties
 * (prohibitions, obligations, expiry) stay in the faithful {@code reed:odrl}
 * asset property and the REED audit trail. In {@code mock} identity mode
 * (iam-mock, no credentials) the policies are rendered permissive.
 */
@Service
public class EdcRenderService {

    private static final String EDC_VOCAB = "https://w3id.org/edc/v0.0.1/ns/";
    private static final String MANAGEMENT_CONTEXT = "https://w3id.org/edc/connector/management/v2";

    /** Left operands the connectors can evaluate from verifiable credentials. */
    static final Set<String> CREDENTIAL_OPERANDS = Set.of(
            "MembershipCredential", "MembershipCredential.role", "MembershipCredential.country",
            "CertificationCredential.certification", "SupplierRelationCredential.partner",
            "SupplierRelationCredential.project");

    private final AssetRepository assets;
    private final PolicyTemplateRepository templates;
    private final PolicyTemplateRenderer renderer;
    private final ReedProperties props;
    private final ParticipantRepository participants;
    private final java.util.Map<String, String> dataKeys;
    private final String dataServiceUrl;

    public EdcRenderService(AssetRepository assets, PolicyTemplateRepository templates,
                            PolicyTemplateRenderer renderer, ReedProperties props, ParticipantRepository participants,
                            @org.springframework.beans.factory.annotation.Value("${reed.usage.data-keys:}") String dataKeys,
                            @org.springframework.beans.factory.annotation.Value("${reed.usage.data-service-url}") String dataServiceUrl) {
        this.assets = assets;
        this.templates = templates;
        this.renderer = renderer;
        this.props = props;
        this.participants = participants;
        this.dataKeys = ConnectorClient.parse(dataKeys);
        this.dataServiceUrl = dataServiceUrl;
    }

    private boolean dcp() {
        return "dcp".equalsIgnoreCase(props.getIdentityMode());
    }

    public List<Map<String, Object>> assets(String owner) {
        return assets.findByOwnerBpnOrderByAssetId(owner).stream().map(this::asset).toList();
    }

    public List<Map<String, Object>> policyDefinitions(String owner) {
        var defs = new ArrayList<Map<String, Object>>();
        // Access policies: one per discoverability value (relations are relative to the owner).
        for (var d : Discoverability.values()) {
            defs.add(policyDefinition(accessPolicyId(d), accessConstraints(d, owner)));
        }
        // Contract policies: one per template used by this owner's assets.
        assets.findByOwnerBpnOrderByAssetId(owner).stream().map(a -> a.policyTemplate).distinct()
                .forEach(t -> defs.add(policyDefinition(contractPolicyId(t), contractConstraints(t, owner))));
        return defs;
    }

    public List<Map<String, Object>> contractDefinitions(String owner) {
        return assets.findByOwnerBpnOrderByAssetId(owner).stream().map(this::contractDefinition).toList();
    }

    public Map<String, Object> asset(Asset a) {
        var faithfulOdrl = templates.findById(a.policyTemplate)
                .map(t -> (Object) renderer.render(t, "*", a.ownerBpn, a.assetId))
                .orElse(Map.of());

        var properties = new LinkedHashMap<String, Object>();
        properties.put("name", a.title);
        properties.put("description", a.description);
        properties.put("contenttype", "application/json");
        properties.put("reed:assetClass", a.assetClass.name());
        properties.put("reed:sensitivity", a.sensitivity.name());
        properties.put("reed:discoverability", a.discoverability.name());
        properties.put("reed:policyTemplate", a.policyTemplate);
        properties.put("reed:ownerBpn", a.ownerBpn);
        properties.put("reed:odrl", faithfulOdrl);

        var dataAddress = new LinkedHashMap<String, Object>();
        dataAddress.put("@type", "DataAddress");
        dataAddress.put("type", "HttpData");
        dataAddress.put("name", a.assetId);
        // The owner's own data service (one per company) holds and releases the payload.
        var owner = participants.findById(a.ownerBpn).map(p -> p.connectorName).orElse(a.ownerBpn);
        dataAddress.put("baseUrl", dataServiceUrl.replace("{name}", owner) + "/submodels/" + a.assetId);
        dataAddress.put("proxyPath", "false");
        dataAddress.put("proxyQueryParams", "false");
        // The owner's data plane presents the owner's data key to its own data service.
        dataAddress.put("authKey", "X-Api-Key");
        dataAddress.put("authCode", dataKeys.getOrDefault(owner, ""));

        var asset = new LinkedHashMap<String, Object>();
        asset.put("@context", List.of(MANAGEMENT_CONTEXT));
        asset.put("@type", "Asset");
        asset.put("@id", a.assetId);
        asset.put("properties", properties);
        asset.put("dataAddress", dataAddress);
        return asset;
    }

    private List<Map<String, Object>> accessConstraints(Discoverability d, String owner) {
        return dcp() ? access(d, owner).stream().map(EdcRenderService::constraint).toList() : List.of();
    }

    /** Catalogue layer: who may discover an asset of this discoverability (relations are relative to the owner). */
    public static List<PolicyEvaluator.Constraint> access(Discoverability d, String owner) {
        return switch (d) {
            case consortium -> List.of(new PolicyEvaluator.Constraint("MembershipCredential", "eq", "active"));
            case bilateral -> List.of(new PolicyEvaluator.Constraint("SupplierRelationCredential.partner", "eq", owner));
            case project -> List.of(new PolicyEvaluator.Constraint("SupplierRelationCredential.project", "eq", owner));
        };
    }

    private List<Map<String, Object>> contractConstraints(String templateName, String owner) {
        return dcp() ? contract(templateName, owner).stream().map(EdcRenderService::constraint).toList() : List.of();
    }

    /** Contract layer: the template's credential-backed permission constraints (other operands stay REED-side). */
    public List<PolicyEvaluator.Constraint> contract(String templateName, String owner) {
        var out = new ArrayList<PolicyEvaluator.Constraint>();
        templates.findById(templateName).ifPresent(t -> {
            JsonNode odrl = renderer.render(t, "*", owner, "");
            for (var permission : odrl.path("permission")) {
                for (var c : permission.path("constraint")) {
                    var left = c.path("leftOperand").asText();
                    if (CREDENTIAL_OPERANDS.contains(left)) {
                        out.add(new PolicyEvaluator.Constraint(left, c.path("operator").asText(), c.path("rightOperand").asText()));
                    }
                }
            }
        });
        if (out.isEmpty()) {
            out.add(new PolicyEvaluator.Constraint("MembershipCredential", "eq", "active"));
        }
        return out;
    }

    /** The access policy definition for one discoverability, for one owner's connector. */
    public Map<String, Object> accessPolicyDefinition(Discoverability d, String owner) {
        return policyDefinition(accessPolicyId(d), accessConstraints(d, owner));
    }

    /** The contract policy definition of one template, for one owner's connector. */
    public Map<String, Object> contractPolicyDefinition(String templateName, String owner) {
        return policyDefinition(contractPolicyId(templateName), contractConstraints(templateName, owner));
    }

    private static Map<String, Object> constraint(PolicyEvaluator.Constraint k) {
        var c = new LinkedHashMap<String, Object>();
        c.put("leftOperand", k.leftOperand());
        c.put("operator", k.operator());
        c.put("rightOperand", k.rightOperand());
        return c;
    }

    private Map<String, Object> policyDefinition(String id, List<Map<String, Object>> constraints) {
        var policy = new LinkedHashMap<String, Object>();
        policy.put("@type", "Set");
        if (constraints.isEmpty()) {
            policy.put("permission", List.of());
        } else {
            var and = constraints.size() == 1 ? constraints.get(0) : Map.of("and", constraints);
            policy.put("permission", List.of(Map.of("action", "use", "constraint", and)));
        }
        policy.put("prohibition", List.of());
        policy.put("obligation", List.of());

        // NB: management/v2 context and no edc @vocab, so credential left operands stay bare
        // ("MembershipCredential.role") - that is what the CEL functions and the DCP scope
        // prefix-mapping match on. An @vocab would expand them into the edc namespace.
        var def = new LinkedHashMap<String, Object>();
        def.put("@context", List.of(MANAGEMENT_CONTEXT));
        def.put("@type", "PolicyDefinition");
        def.put("@id", id);
        def.put("policy", policy);
        return def;
    }

    /**
     * CEL expressions binding each credential left operand to a check over the
     * requester's verified credentials ({@code ctx.agent.claims.vc}). Registered
     * on every connector (all are providers), evaluated in catalog, negotiation
     * and transfer scopes. {@link org.example.reed.policy.PolicyEvaluator} mirrors them.
     */
    public List<Map<String, Object>> celExpressions() {
        return List.of(
                cel("MembershipCredential", "MembershipCredential", "cs.membership == this.rightOperand"),
                cel("MembershipCredential.role", "MembershipCredential", byOperator("role")),
                cel("MembershipCredential.country", "MembershipCredential", byOperator("country")),
                cel("CertificationCredential.certification", "CertificationCredential", contains("certifications")),
                cel("SupplierRelationCredential.partner", "SupplierRelationCredential", contains("partners")),
                cel("SupplierRelationCredential.project", "SupplierRelationCredential", contains("projects")));
    }

    private static String contains(String claim) {
        // ponytail: delimited-string claims (",A,B,") keep the issuer's database attestation one row per holder;
        // switch to JSON-array claims if the issuer gains list mappings.
        return "cs." + claim + ".contains(',' + string(this.rightOperand) + ',')";
    }

    /** eq / neq / isAnyOf / isNoneOf ({@code this.operator} is the EDC operator's name) over a single-valued claim. */
    private static String byOperator(String claim) {
        var v = "cs." + claim;
        var r = "string(this.rightOperand)";
        var inList = "(',' + " + r + " + ',').contains(',' + " + v + " + ',')";
        return "(this.operator == 'NEQ' ? " + v + " != " + r
                + " : this.operator == 'IS_ANY_OF' ? " + inList
                + " : this.operator == 'IS_NONE_OF' ? !" + inList
                + " : " + v + " == " + r + ")";
    }

    private static Map<String, Object> cel(String leftOperand, String credentialType, String subjectCheck) {
        var vcs = "('vc' in ctx.agent.claims ? ctx.agent.claims.vc : []).filter(c, c.type.exists(t, t == '"
                + credentialType + "'))";
        var def = new LinkedHashMap<String, Object>();
        def.put("@context", List.of(MANAGEMENT_CONTEXT));
        def.put("@type", "CelExpression");
        def.put("@id", "reed-" + leftOperand.toLowerCase().replaceAll("[^a-z]", "-"));
        def.put("leftOperand", leftOperand);
        def.put("description", "REED: " + leftOperand + " from the requester's verifiable credentials");
        def.put("scopes", List.of("catalog", "contract.negotiation", "transfer.process"));
        def.put("expression", vcs + ".exists(c, c.credentialSubject.exists(cs, " + subjectCheck + "))");
        return def;
    }

    public Map<String, Object> contractDefinition(Asset a) {
        var criterion = new LinkedHashMap<String, Object>();
        criterion.put("@type", "Criterion");
        criterion.put("operandLeft", EDC_VOCAB + "id");
        criterion.put("operator", "=");
        criterion.put("operandRight", a.assetId);

        var def = new LinkedHashMap<String, Object>();
        def.put("@context", List.of(MANAGEMENT_CONTEXT));
        def.put("@type", "ContractDefinition");
        def.put("@id", "reed-contract-" + a.assetId);
        def.put("accessPolicyId", accessPolicyId(a.discoverability));
        def.put("contractPolicyId", contractPolicyId(a.policyTemplate));
        def.put("assetsSelector", List.of(criterion));
        return def;
    }

    private static String accessPolicyId(Discoverability d) {
        return "reed-access-" + d.name();
    }

    private static String contractPolicyId(String templateName) {
        return "reed-policy-" + templateName;
    }
}
