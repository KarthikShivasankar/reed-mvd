/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.match;

import org.example.reed.domain.CapabilityClaim;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Explainable, deterministic supplier scoring. Pure function: no Spring, no
 * database, no clock - everything it needs is passed in, so the same inputs
 * always give the same ranking and the unit tests run without a stack.
 *
 * <p><b>Hard filters</b> reject a supplier with machine-readable codes
 * (process, material, envelope in any axis-aligned orientation, mass,
 * tolerance, lead time, and certifications - only <em>verified</em> credentials
 * count, self-declared claims never do). <b>Soft criteria</b> rank the
 * qualified suppliers by a weighted sum of normalised [0..1] scores, each
 * reported with its weight, contribution and a human-readable note.
 */
public final class MatchScorer {

    /** Parts heavier or longer than this need special transport (port/rail access). */
    static final double BULKY_MASS_KG = 20_000;
    static final double BULKY_DIM_MM = 4_000;
    static final double LOGISTICS_HORIZON_KM = 2_500;

    public record Weights(double lead, double tolerance, double logistics, double trust,
                          double sector, double carbon) {
        public static final Weights DEFAULT = new Weights(0.20, 0.15, 0.20, 0.15, 0.10, 0.20);
    }

    /** What the buyer needs. {@code material}/{@code tolMm} may be null (e.g. a logistics or NDT step). */
    public record Demand(String id, String sector, String material, List<Integer> dimsMm, double massKg,
                         Double tolMm, int quantity, double weeksAvailable,
                         List<String> requiredProcesses, List<String> requiredCerts,
                         double deliveryLat, double deliveryLon) {
    }

    /** A candidate supplier: public claim + verified credentials + platform track record. */
    public record Supplier(String bpn, String name, double lat, double lon, boolean portAccess,
                           boolean railAccess, List<String> sectors, CapabilityClaim capability,
                           Set<String> verifiedCerts, int goodDeliveries, int totalDeliveries) {
    }

    public record Rejection(String code, String detail) {
    }

    public record Criterion(String key, String label, double weight, double score, double contribution,
                            String note) {
    }

    public record Result(String bpn, String name, boolean qualified, double score, double distanceKm,
                         double trust, List<Criterion> breakdown, List<Rejection> rejections) {
    }

    private final Weights weights;

    public MatchScorer(Weights weights) {
        this.weights = weights;
    }

    /** Scores every supplier and returns qualified ones first (ranked), then the rejected ones. */
    public List<Result> rank(Demand demand, List<Supplier> suppliers) {
        var results = suppliers.stream().map(s -> score(demand, s)).toList();
        var qualified = results.stream().filter(Result::qualified)
                .sorted(Comparator.comparingDouble(Result::score).reversed()
                        .thenComparing(Comparator.comparingDouble(Result::trust).reversed())
                        .thenComparingDouble(Result::distanceKm)
                        .thenComparing(Result::bpn))
                .toList();
        var rejected = results.stream().filter(r -> !r.qualified())
                .sorted(Comparator.comparing(Result::bpn)).toList();
        var all = new ArrayList<>(qualified);
        all.addAll(rejected);
        return all;
    }

    public Result score(Demand d, Supplier s) {
        var cap = s.capability();
        var distance = haversineKm(s.lat(), s.lon(), d.deliveryLat(), d.deliveryLon());
        var trust = (s.goodDeliveries() + 1.0) / (s.totalDeliveries() + 2.0); // Laplace prior 0.5
        var rejections = new ArrayList<Rejection>();

        var missing = new LinkedHashSet<>(d.requiredProcesses());
        missing.removeAll(cap.processes());
        if (!missing.isEmpty()) {
            rejections.add(new Rejection("PROCESS_MISSING", "does not offer " + String.join(", ", missing)));
        }
        if (d.material() != null && !cap.materials().contains(d.material())) {
            rejections.add(new Rejection("MATERIAL_UNSUPPORTED", d.material() + " not in material list"));
        }
        if (cap.envelopeMm() != null && !fits(d.dimsMm(), cap.envelopeMm())) {
            rejections.add(new Rejection("ENVELOPE_TOO_SMALL",
                    "part " + dims(d.dimsMm()) + " mm exceeds envelope " + dims(cap.envelopeMm()) + " mm in every orientation"));
        }
        if (cap.maxMassKg() != null && d.massKg() > cap.maxMassKg()) {
            rejections.add(new Rejection("MASS_EXCEEDED",
                    String.format("%.0f t part > %.0f t capacity", d.massKg() / 1000, cap.maxMassKg() / 1000)));
        }
        if (d.tolMm() != null && cap.bestTolMm() != null && cap.bestTolMm() > d.tolMm()) {
            rejections.add(new Rejection("TOLERANCE_NOT_MET",
                    "best achievable ±" + cap.bestTolMm() + " mm > required ±" + d.tolMm() + " mm"));
        }
        if (cap.leadTimeWeeks() != null && cap.leadTimeWeeks() > d.weeksAvailable()) {
            rejections.add(new Rejection("LEAD_TIME_EXCEEDED",
                    cap.leadTimeWeeks() + " weeks lead time > " + Math.round(d.weeksAvailable()) + " weeks available"));
        }
        for (var cert : d.requiredCerts()) {
            if (!s.verifiedCerts().contains(cert)) {
                var claimed = cap.claimedCerts().contains(cert);
                rejections.add(new Rejection("CERT_NOT_VERIFIED", cert + (claimed
                        ? " is only self-declared - no verifiable credential from a trusted issuer"
                        : " not held")));
            }
        }
        if (!rejections.isEmpty()) {
            return new Result(s.bpn(), s.name(), false, 0, round(distance), round(trust), List.of(), rejections);
        }

        var breakdown = new ArrayList<Criterion>();
        // Lead time: share of the buyer's window left as buffer, discounted by capacity band.
        var lead = cap.leadTimeWeeks() == null ? 1.0
                : clamp((d.weeksAvailable() - cap.leadTimeWeeks()) / d.weeksAvailable()) * capacityFactor(cap.capacity());
        breakdown.add(criterion("lead", "Lead time & capacity", weights.lead(), lead,
                cap.leadTimeWeeks() == null ? "no lead time stated"
                        : cap.leadTimeWeeks() + " of " + Math.round(d.weeksAvailable()) + " weeks, capacity " + cap.capacity()));
        // Tolerance: margin between what is required and what the supplier achieves.
        var tol = d.tolMm() == null || cap.bestTolMm() == null ? 1.0 : clamp(1 - cap.bestTolMm() / d.tolMm());
        breakdown.add(criterion("tolerance", "Tolerance margin", weights.tolerance(), tol,
                d.tolMm() == null || cap.bestTolMm() == null ? "not applicable"
                        : "±" + cap.bestTolMm() + " mm achievable vs ±" + d.tolMm() + " mm required"));
        // Logistics: distance to delivery; bulky parts without port/rail access are heavily penalised.
        var logistics = 1 - Math.min(distance / LOGISTICS_HORIZON_KM, 1);
        var bulky = d.massKg() > BULKY_MASS_KG || d.dimsMm().stream().anyMatch(x -> x > BULKY_DIM_MM);
        var note = Math.round(distance) + " km to delivery site";
        if (bulky && !(s.portAccess() || s.railAccess())) {
            logistics *= 0.3;
            note += "; bulky part but no port/rail access (x0.3)";
        } else if (bulky) {
            note += "; bulky part, " + (s.portAccess() ? "quay" : "rail") + " access";
        }
        breakdown.add(criterion("logistics", "Logistics", weights.logistics(), logistics, note));
        breakdown.add(criterion("trust", "Track record", weights.trust(), trust,
                s.totalDeliveries() == 0 ? "no REED deliveries yet (neutral prior)"
                        : s.goodDeliveries() + " of " + s.totalDeliveries() + " REED deliveries on time and quality-OK"));
        var sector = s.sectors().contains(d.sector()) ? 1.0 : 0.3;
        breakdown.add(criterion("sector", "Sector experience", weights.sector(), sector,
                sector == 1.0 ? "active in " + d.sector() : "no " + d.sector() + " references"));
        // Carbon: embedded kg CO2e per kg of product (CBAM-relevant for iron & steel), 0.4 best .. 2.5 worst.
        var carbon = cap.co2KgPerKg() == null ? 0.5 : clamp((2.5 - cap.co2KgPerKg()) / 2.1);
        breakdown.add(criterion("carbon", "Embedded CO2 (CBAM)", weights.carbon(), carbon,
                cap.co2KgPerKg() == null ? "not declared (neutral)" : cap.co2KgPerKg() + " kg CO2e per kg"));

        var total = breakdown.stream().mapToDouble(Criterion::contribution).sum();
        return new Result(s.bpn(), s.name(), true, round(total), round(distance), round(trust), breakdown, List.of());
    }

    /**
     * The demand for a partner step the main supplier does not cover (e.g. NDT,
     * heavy-lift, finish machining): same part, only that process, no material
     * or tolerance constraint.
     */
    public static Demand partnerDemand(Demand d, String process) {
        return new Demand(d.id() + ":" + process, d.sector(), null, d.dimsMm(), d.massKg(), null, d.quantity(),
                d.weeksAvailable(), List.of(process), List.of(), d.deliveryLat(), d.deliveryLon());
    }

    /** True if the part fits the envelope in some axis-aligned orientation (compare sorted dimensions). */
    static boolean fits(List<Integer> part, List<Integer> envelope) {
        var p = part.stream().sorted(Comparator.reverseOrder()).toList();
        var e = envelope.stream().sorted(Comparator.reverseOrder()).toList();
        for (int i = 0; i < Math.min(p.size(), e.size()); i++) {
            if (p.get(i) > e.get(i)) {
                return false;
            }
        }
        return true;
    }

    static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        var dLat = Math.toRadians(lat2 - lat1);
        var dLon = Math.toRadians(lon2 - lon1);
        var a = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(dLon / 2), 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private static double capacityFactor(String band) {
        if (band == null) {
            return 0.85;
        }
        return switch (band) {
            case "LOW" -> 0.6;
            case "HIGH" -> 1.0;
            default -> 0.85;
        };
    }

    private static Criterion criterion(String key, String label, double weight, double score, String note) {
        return new Criterion(key, label, weight, round(score), round(weight * score), note);
    }

    private static String dims(List<Integer> d) {
        return String.join(" x ", d.stream().map(String::valueOf).toList());
    }

    private static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }

    private static double round(double v) {
        return Math.round(v * 1000) / 1000.0;
    }
}
