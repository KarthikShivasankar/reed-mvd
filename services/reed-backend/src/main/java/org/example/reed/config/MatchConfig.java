/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.config;

import org.example.reed.match.MatchScorer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/** Matchmaking weights ({@code reed.match.weights.*}) and the clock lead times are measured with. */
@Configuration
public class MatchConfig {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    MatchScorer.Weights weights(@Value("${reed.match.weights.lead}") double lead,
                                @Value("${reed.match.weights.tolerance}") double tolerance,
                                @Value("${reed.match.weights.logistics}") double logistics,
                                @Value("${reed.match.weights.trust}") double trust,
                                @Value("${reed.match.weights.sector}") double sector,
                                @Value("${reed.match.weights.carbon}") double carbon) {
        return new MatchScorer.Weights(lead, tolerance, logistics, trust, sector, carbon);
    }
}
