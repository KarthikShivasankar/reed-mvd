/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.domain.PolicyTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Renders a {@link PolicyTemplate}'s portable ODRL fragment into a concrete
 * ODRL object by substituting the per-request placeholders
 * ({@code $REQUESTER_BPN}, {@code $OWNER_BPN}, {@code $ASSET_ID},
 * {@code $EXPIRY}).
 *
 * <p>This is the <em>faithful</em> REED policy across all three layers. Under
 * the demo's {@code iam-mock} the EDC connector cannot evaluate these BPN/time
 * constraints (no verifiable claims), so the connector receives a permissive
 * policy and REED enforces/records the real semantics. The rendered ODRL here
 * is what a production DCP/IdentityHub deployment would enforce, and is exposed
 * as asset metadata and via the REED APIs for transparency.
 */
@Component
public class PolicyTemplateRenderer {

    private final ObjectMapper mapper;

    public PolicyTemplateRenderer(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public JsonNode render(PolicyTemplate template, String requesterBpn, String ownerBpn, String assetId) {
        try {
            var expiry = Instant.now().plus(30, ChronoUnit.DAYS).toString();
            var json = template.odrl
                    .replace("$REQUESTER_BPN", requesterBpn == null ? "*" : requesterBpn)
                    .replace("$OWNER_BPN", ownerBpn == null ? "" : ownerBpn)
                    .replace("$ASSET_ID", assetId == null ? "" : assetId)
                    .replace("$EXPIRY", expiry);
            return mapper.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to render policy template " + template.name, e);
        }
    }
}
