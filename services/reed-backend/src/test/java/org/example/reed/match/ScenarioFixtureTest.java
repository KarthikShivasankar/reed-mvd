/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.match;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.participant.Roster;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import java.nio.file.Path;
import java.util.HashSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Keeps the real-case scenarios (deployment/scenarios/matchmaking.json) and the
 * scoring algorithm honest: every RFQ's documented expected winner, runner-up,
 * rejection reasons and partner recommendations must hold.
 */
class ScenarioFixtureTest {

    private static final Path DEPLOYMENT = Path.of(System.getProperty("reed.deployment", "../../deployment"));

    @TestFactory
    Stream<DynamicTest> everyScenarioRanksAsDocumented() throws Exception {
        var mapper = new ObjectMapper();
        var roster = Roster.load(mapper, DEPLOYMENT.resolve("roster.json"));
        var scenarios = Roster.loadScenarios(mapper, DEPLOYMENT.resolve("scenarios/matchmaking.json"));
        var suppliers = roster.participants().stream()
                .filter(p -> p.member() && p.capability() != null)
                .map(MatchService::fromSpec)
                .toList();
        var scorer = new MatchScorer(MatchScorer.Weights.DEFAULT);

        return scenarios.rfqs().stream().map(rfq -> DynamicTest.dynamicTest(rfq.id() + " " + rfq.title(), () -> {
            var buyer = roster.participants().stream().filter(p -> p.bpn().equals(rfq.buyer())).findFirst().orElseThrow();
            var demand = MatchService.demandFromSpec(rfq, buyer.lat(), buyer.lon());
            var ranked = scorer.rank(demand, suppliers.stream().filter(s -> !s.bpn().equals(rfq.buyer())).toList());

            assertThat(ranked.get(0).qualified()).as("someone qualifies").isTrue();
            assertThat(ranked.get(0).bpn()).as("top match").isEqualTo(rfq.expectedTop());
            if (rfq.expectedSecond() != null) {
                assertThat(ranked.get(1).bpn()).as("runner-up").isEqualTo(rfq.expectedSecond());
            }
            if (rfq.expectedRejections() != null) {
                rfq.expectedRejections().forEach((bpn, codes) -> {
                    var r = ranked.stream().filter(x -> x.bpn().equals(bpn)).findFirst().orElseThrow();
                    assertThat(r.qualified()).as(bpn + " rejected").isFalse();
                    var actual = new HashSet<>(r.rejections().stream().map(MatchScorer.Rejection::code).toList());
                    assertThat(actual).as(bpn + " rejection codes").containsAll(codes);
                });
            }
            if (rfq.expectedPartners() != null) {
                rfq.expectedPartners().forEach((process, bpn) -> {
                    var partners = scorer.rank(MatchScorer.partnerDemand(demand, process), suppliers);
                    assertThat(partners.get(0).qualified()).isTrue();
                    assertThat(partners.get(0).bpn()).as("partner for " + process).isEqualTo(bpn);
                });
            }
        }));
    }
}
