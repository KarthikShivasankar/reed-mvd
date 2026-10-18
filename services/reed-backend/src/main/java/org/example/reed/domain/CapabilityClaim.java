/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * A supplier's <b>public</b>, consortium-level capability claim - what
 * matchmaking scores on. It deliberately carries only coarse figures; the exact
 * machine list, free capacity and Cpk live in the supplier's confidential
 * {@code ProcessCapability} asset, which a buyer receives only after an EDC
 * contract (the REED "discover, then contract" invariant).
 *
 * <p>{@code envelopeMm} is the largest part (L, W, H in mm) the supplier can
 * handle; {@code claimedCerts} are self-declared and never satisfy a hard
 * certification filter on their own - only verified credentials do.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CapabilityClaim(
        String summary,
        List<String> processes,
        List<String> materials,
        List<Integer> envelopeMm,
        Double maxMassKg,
        Double bestTolMm,
        Integer leadTimeWeeks,
        String capacity,
        Double co2KgPerKg,
        List<String> claimedCerts) {

    public List<String> processes() {
        return processes == null ? List.of() : processes;
    }

    public List<String> materials() {
        return materials == null ? List.of() : materials;
    }

    public List<String> claimedCerts() {
        return claimedCerts == null ? List.of() : claimedCerts;
    }
}
