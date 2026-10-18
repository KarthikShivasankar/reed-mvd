/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.assistant;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AssistantGuardrailsTest {

    @Test
    void rulesExtractTheNumbersOfARealRequest() {
        var d = RuleRfqParser.parse("We need 12 ductile iron rotor hubs for a 6 MW offshore wind turbine, "
                        + "4.2 x 4.0 x 3.6 m, 38 t each, DNV approval, cast and heat treated, UT testing, within 40 weeks.",
                List.of("EN-GJS-400-18-LT", "G20Mn5"), List.of("DNV", "ISO9001"));
        assertThat(d.dimsMm()).containsExactly(4200, 4000, 3600);
        assertThat(d.massKg()).isEqualTo(38000.0);
        assertThat(d.quantity()).isEqualTo(12);
        assertThat(d.dueInWeeks()).isEqualTo(40);
        assertThat(d.material()).isEqualTo("EN-GJS-400-18-LT");
        assertThat(d.requiredCerts()).containsExactly("DNV");
        assertThat(d.sector()).isEqualTo("wind");
        assertThat(d.requiredProcesses()).contains("sand-casting", "heat-treatment");
        assertThat(d.partnerProcesses()).contains("ndt-ut");
    }

    @Test
    void personalDataIsRedactedBeforeTheModelSeesIt() {
        var r = PersonalDataRedactor.redact("Call Ingrid Berg on +47 912 34 567 or ingrid.berg@nordvind.example "
                + "about the 38 t hub (4.2 x 4.0 x 3.6 m).", List.of("Ingrid Berg"));
        assertThat(r.text()).doesNotContain("Ingrid", "912", "@").contains("38 t", "4.2 x 4.0 x 3.6 m");
        assertThat(r.redactions()).isEqualTo(3);
    }

    @Test
    void explanationsMayOnlyQuoteScorerNumbers() {
        var input = "{\"score\":0.733,\"contribution\":0.166}";
        assertThat(AssistantService.numbersGrounded("Sachsen leads with 0.733.", input)).isTrue();
        assertThat(AssistantService.numbersGrounded("Sachsen leads with 0.91.", input)).isFalse();
    }
}
