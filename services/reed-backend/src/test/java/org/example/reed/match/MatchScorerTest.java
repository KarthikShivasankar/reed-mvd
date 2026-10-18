/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.match;

import org.example.reed.domain.CapabilityClaim;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class MatchScorerTest {

    private final MatchScorer scorer = new MatchScorer(MatchScorer.Weights.DEFAULT);

    private static CapabilityClaim cap(List<Integer> env, List<String> claimed) {
        return new CapabilityClaim("", List.of("sand-casting"), List.of("G20Mn5"), env, 60000.0, 1.0, 10,
                "MEDIUM", 1.0, claimed);
    }

    private static MatchScorer.Demand demand(List<Integer> dims, List<String> certs) {
        return new MatchScorer.Demand("T", "offshore", "G20Mn5", dims, 20000, 2.0, 1, 30,
                List.of("sand-casting"), certs, 54.3, 10.1);
    }

    private static MatchScorer.Supplier supplier(String bpn, CapabilityClaim cap, Set<String> verified,
                                                 int good, int total) {
        return new MatchScorer.Supplier(bpn, bpn, 54.3, 10.1, true, true, List.of("offshore"), cap, verified,
                good, total);
    }

    @Test
    void partFitsOnlyAfterRotation() {
        // 4.2 x 3.6 x 4.0 m part, 7.0 x 4.0 x 7.0 m envelope: fits once the 4.2 m axis is laid along a 7 m axis.
        var r = scorer.score(demand(List.of(4200, 3600, 4000), List.of()),
                supplier("A", cap(List.of(7000, 4000, 7000), List.of()), Set.of(), 0, 0));
        assertThat(r.qualified()).isTrue();

        var tooBig = scorer.score(demand(List.of(4200, 4200, 4200), List.of()),
                supplier("A", cap(List.of(7000, 4000, 7000), List.of()), Set.of(), 0, 0));
        assertThat(tooBig.rejections()).extracting(MatchScorer.Rejection::code).containsExactly("ENVELOPE_TOO_SMALL");
    }

    @Test
    void selfDeclaredCertificationNeverPassesTheHardFilter() {
        var claimedOnly = scorer.score(demand(List.of(1000, 1000, 1000), List.of("DNV")),
                supplier("A", cap(List.of(7000, 7000, 4000), List.of("DNV")), Set.of(), 0, 0));
        assertThat(claimedOnly.qualified()).isFalse();
        assertThat(claimedOnly.rejections().get(0).code()).isEqualTo("CERT_NOT_VERIFIED");
        assertThat(claimedOnly.rejections().get(0).detail()).contains("self-declared");

        var verified = scorer.score(demand(List.of(1000, 1000, 1000), List.of("DNV")),
                supplier("A", cap(List.of(7000, 7000, 4000), List.of()), Set.of("DNV"), 0, 0));
        assertThat(verified.qualified()).isTrue();
    }

    @Test
    void equalScoresAreTieBrokenDeterministically() {
        var c = cap(List.of(7000, 7000, 4000), List.of());
        var d = demand(List.of(1000, 1000, 1000), List.of());
        // Same capability, location and track record -> same score -> ordered by BPN.
        var ranked = scorer.rank(d, List.of(supplier("B", c, Set.of(), 1, 1), supplier("A", c, Set.of(), 1, 1)));
        assertThat(ranked).extracting(MatchScorer.Result::bpn).containsExactly("A", "B");
        // A better track record raises the trust criterion and wins.
        var withHistory = scorer.rank(d, List.of(supplier("A", c, Set.of(), 0, 1), supplier("B", c, Set.of(), 3, 3)));
        assertThat(withHistory.get(0).bpn()).isEqualTo("B");
    }

    @Test
    void contributionsSumToTheScore() {
        var r = scorer.score(demand(List.of(1000, 1000, 1000), List.of()),
                supplier("A", cap(List.of(7000, 7000, 4000), List.of()), Set.of(), 2, 3));
        var sum = r.breakdown().stream().mapToDouble(MatchScorer.Criterion::contribution).sum();
        assertThat(r.score()).isCloseTo(sum, org.assertj.core.data.Offset.offset(0.002));
        assertThat(r.breakdown()).hasSize(6);
    }
}
