/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy.opa;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.policy.odrl.RegoMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * REED's side of the Open Policy Agents: it <em>deploys</em> generated Rego to a company's OPA (or its
 * own, {@value #REED}) and asks its own OPA for matchmaking-time decisions. Runtime decisions are asked
 * by the provider's enforcement point (its data service), not from here.
 */
@Component
public class OpaClient {

    /** REED's own OPA; every other name is a connector name. */
    public static final String REED = "reed";

    private final RestClient http;
    private final ObjectMapper mapper;
    private final String urlPattern;
    private final Map<String, String> tokens;

    public OpaClient(ObjectMapper mapper, @Value("${reed.opa.url-pattern}") String urlPattern,
                     @Value("${reed.opa.tokens:}") String tokens) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3_000);
        factory.setReadTimeout(10_000);
        this.http = RestClient.builder().requestFactory(factory).build();
        this.mapper = mapper;
        this.urlPattern = urlPattern;
        this.tokens = ConnectorClient.parse(tokens);
    }

    public String url(String opa) {
        return urlPattern.replace("{name}", opa);
    }

    /** Where the enforcement point asks: {@code <opa>/v1/data/reed/policy/<policy>/<rule>}. */
    public static String path(String policyId, String rule) {
        return "/v1/data/reed/policy/" + RegoMapper.name(policyId) + "/" + rule;
    }

    /** Creates or replaces the policy module. */
    public void deploy(String opa, String policyId, String rego) {
        try {
            http.put().uri(url(opa) + "/v1/policies/" + RegoMapper.name(policyId)).headers(h -> h.setBearerAuth(token(opa)))
                    .contentType(MediaType.TEXT_PLAIN).body(rego).retrieve().toBodilessEntity();
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "policy " + policyId + " could not be deployed to " + url(opa)
                    + ": " + e.getMessage());
        }
    }

    /** The module's text as that OPA holds it, or null if it has none (or cannot be asked). */
    public String deployed(String opa, String policyId) {
        try {
            var body = http.get().uri(url(opa) + "/v1/policies/" + RegoMapper.name(policyId)).headers(h -> h.setBearerAuth(token(opa)))
                    .retrieve().body(String.class);
            return mapper.readTree(body).path("result").path("raw").asText(null);
        } catch (Exception e) {
            return null;
        }
    }

    /** Is this OPA answering? (for the operator's connector overview) */
    public boolean up(String opa) {
        try {
            http.get().uri(url(opa) + "/health").headers(h -> h.setBearerAuth(token(opa))).retrieve().toBodilessEntity();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * @param rule {@code eligibility} or {@code decision}
     * @return OPA's result object: {decision, policy, conditions, failed}
     */
    public JsonNode evaluate(String opa, String policyId, String rule, Object input) {
        JsonNode result;
        try {
            var body = http.post().uri(url(opa) + path(policyId, rule)).headers(h -> h.setBearerAuth(token(opa)))
                    .contentType(MediaType.APPLICATION_JSON).body(mapper.writeValueAsString(Map.of("input", input)))
                    .retrieve().body(String.class);
            result = mapper.readTree(body).path("result");
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "policy decision point " + url(opa) + " unavailable: " + e.getMessage());
        }
        if (!result.has("decision")) {
            // OPA answers {} for a rule it does not know: never read that as a decision
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "policy " + policyId + " is not deployed at " + url(opa));
        }
        return result;
    }

    private String token(String opa) {
        var t = tokens.get(opa);
        if (t == null || t.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "no deploy token configured for policy decision point " + opa);
        }
        return t;
    }
}
