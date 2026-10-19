/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.usage;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The usage terms a payload is released under (the REED usage layer), derived from the asset's
 * policy template and the contract agreement. Pure, so the expiry rule is unit-tested.
 */
public record Licence(String licensee, String licenseeDid, String owner, String assetId, String agreementId,
                      Instant issuedAt, Instant expiresAt, List<String> prohibitions, List<String> obligations) {

    /**
     * @param odrl         the asset's rendered policy template
     * @param signedAt     contract signing time
     * @param pilotLength  how long a time-limited (odrl:dateTime-constrained) licence lasts after signing
     */
    public static Licence of(JsonNode odrl, String licensee, String licenseeDid, String owner, String assetId,
                             String agreementId, Instant signedAt, Instant now, Duration pilotLength) {
        var timeLimited = false;
        for (var p : odrl.path("permission")) {
            for (var c : p.path("constraint")) {
                timeLimited |= "odrl:dateTime".equals(c.path("leftOperand").asText());
            }
        }
        return new Licence(licensee, licenseeDid, owner, assetId, agreementId, now,
                timeLimited ? signedAt.plus(pilotLength) : null, actions(odrl.path("prohibition")),
                actions(odrl.path("obligation")));
    }

    public boolean expired(Instant now) {
        return expiresAt != null && now.isAfter(expiresAt);
    }

    private static List<String> actions(JsonNode rules) {
        var out = new ArrayList<String>();
        rules.forEach(r -> out.add(r.path("action").asText()));
        return out;
    }
}
