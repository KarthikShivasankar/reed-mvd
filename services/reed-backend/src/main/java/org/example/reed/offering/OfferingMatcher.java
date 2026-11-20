/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.offering;

import org.example.reed.policy.PolicyEvaluator;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Capability match of a service RFQ against one offering: named yes/no checks, no score. Pure and
 * deterministic. It says nothing about whether the buyer <em>may</em> have the offering - that is the
 * policy's question, answered separately by Open Policy Agent.
 */
public final class OfferingMatcher {

    public record Demand(String capability, List<String> keywords, Integer requiredCapacity, String preferredRegion) {
    }

    public record Supply(String capability, String name, String description, List<String> keywords, Integer capacityPerMonth,
                         String providerCountry) {
    }

    public record Check(String key, String label, boolean pass, String detail) {
    }

    private static final List<String> NORDIC = List.of("DK", "FI", "IS", "NO", "SE");

    private OfferingMatcher() {
    }

    public static List<Check> checks(Demand d, Supply s) {
        var out = new ArrayList<Check>();
        out.add(new Check("capability", "Capability", s.capability().equalsIgnoreCase(d.capability()),
                "offers " + s.capability() + ", requested " + d.capability()));

        var haystack = (s.name() + " " + s.description() + " " + String.join(" ", s.keywords())).toLowerCase(Locale.ROOT);
        var missing = nn(d.keywords()).stream().filter(k -> !haystack.contains(k.toLowerCase(Locale.ROOT))).toList();
        out.add(new Check("keywords", "Technical requirements", missing.isEmpty(),
                nn(d.keywords()).isEmpty() ? "none requested" : missing.isEmpty() ? "covers " + String.join(", ", d.keywords())
                        : "does not cover " + String.join(", ", missing)));

        var need = d.requiredCapacity();
        out.add(new Check("capacity", "Capacity", need == null || (s.capacityPerMonth() != null && s.capacityPerMonth() >= need),
                need == null ? "none requested" : (s.capacityPerMonth() == null ? "no capacity stated" : s.capacityPerMonth() + " h/month available")
                        + ", " + need + " h/month requested"));

        var region = d.preferredRegion() == null || d.preferredRegion().isBlank() ? null : d.preferredRegion().toUpperCase(Locale.ROOT);
        out.add(new Check("region", "Region", region == null || countries(region).contains(s.providerCountry()),
                region == null ? "anywhere" : "provider in " + s.providerCountry() + ", requested " + region));
        return out;
    }

    public static boolean matches(List<Check> checks) {
        return checks.stream().allMatch(Check::pass);
    }

    /** EU, EEA, NORDIC or a single country code. */
    static List<String> countries(String region) {
        return switch (region) {
            case "EU" -> PolicyEvaluator.EU27;
            case "EEA" -> {
                var l = new ArrayList<>(PolicyEvaluator.EU27);
                l.addAll(PolicyEvaluator.EEA_EFTA);
                yield l;
            }
            case "NORDIC" -> NORDIC;
            default -> List.of(region);
        };
    }

    private static List<String> nn(List<String> l) {
        return l == null ? List.of() : l;
    }
}
