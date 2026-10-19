/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.usage;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class LicenceTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final Instant signed = Instant.parse("2026-01-01T00:00:00Z");

    @Test
    void timeLimitedLicencesExpireAfterThePilot() throws Exception {
        var pilot = mapper.readTree("""
                {"permission":[{"action":"use","constraint":[{"leftOperand":"odrl:dateTime","operator":"lteq","rightOperand":"x"}]}],
                 "prohibition":[{"action":"distribute"}],"obligation":[{"action":"delete"}]}""");
        var l = Licence.of(pilot, "BPN-C", "did:c", "BPN-O", "a", "agr", signed, signed.plusSeconds(60), Duration.ofDays(30));
        assertThat(l.expiresAt()).isEqualTo(signed.plus(Duration.ofDays(30)));
        assertThat(l.expired(signed.plus(Duration.ofDays(29)))).isFalse();
        assertThat(l.expired(signed.plus(Duration.ofDays(31)))).isTrue();
        assertThat(l.prohibitions()).containsExactly("distribute");
        assertThat(l.obligations()).containsExactly("delete");
    }

    @Test
    void otherLicencesDoNotExpire() throws Exception {
        var oemOnly = mapper.readTree("""
                {"permission":[{"action":"use","constraint":[{"leftOperand":"MembershipCredential.role","operator":"eq","rightOperand":"OEM"}]}],
                 "prohibition":[{"action":"distribute"}],"obligation":[{"action":"reed:audit"}]}""");
        var l = Licence.of(oemOnly, "BPN-C", "did:c", "BPN-O", "a", "agr", signed, signed, Duration.ofDays(30));
        assertThat(l.expiresAt()).isNull();
        assertThat(l.expired(signed.plus(Duration.ofDays(3650)))).isFalse();
    }
}
