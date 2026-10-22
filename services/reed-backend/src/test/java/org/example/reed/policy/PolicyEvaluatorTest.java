/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy;

import org.example.reed.policy.PolicyEvaluator.Claims;
import org.example.reed.policy.PolicyEvaluator.Constraint;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;

class PolicyEvaluatorTest {

    private static final Function<String, String> NAME = bpn -> bpn.equals("BPN-OWNER") ? "Owner" : bpn;
    private static final String EEA;
    static {
        var l = new ArrayList<>(PolicyEvaluator.EU27);
        l.addAll(PolicyEvaluator.EEA_EFTA);
        EEA = String.join(",", l);
    }

    private static final Claims NORWAY_OEM = new Claims(true, "OEM", "NO", Set.of("ISO9001"), Set.of("BPN-OWNER"), Set.of());
    private static final Claims GERMAN_OEM = new Claims(true, "OEM", "DE", Set.of("ISO9001", "DNV"), Set.of(), Set.of());
    private static final Claims SPANISH_SUPPLIER = new Claims(true, "SUPPLIER", "ES", Set.of("DNV"), Set.of(), Set.of("BPN-OWNER"));

    @Test
    void euIsNotTheEea() {
        var euOnly = List.of(new Constraint("MembershipCredential.country", "isAnyOf", String.join(",", PolicyEvaluator.EU27)));
        var eea = List.of(new Constraint("MembershipCredential.country", "isAnyOf", EEA));
        assertThat(PolicyEvaluator.evaluate(eea, NORWAY_OEM, NAME).allowed()).isTrue();
        var d = PolicyEvaluator.evaluate(euOnly, NORWAY_OEM, NAME);
        assertThat(d.allowed()).isFalse();
        assertThat(d.reason()).isEqualTo("registered in NO, but the policy needs registered seat in the EU");
        assertThat(PolicyEvaluator.evaluate(euOnly, GERMAN_OEM, NAME).reason()).isEqualTo("registered seat in the EU");
    }

    @Test
    void constraintsAreAndedAndTheFirstUnmetOneIsTheReason() {
        var offshoreOem = List.of(new Constraint("MembershipCredential.role", "eq", "OEM"),
                new Constraint("CertificationCredential.certification", "eq", "DNV"));
        assertThat(PolicyEvaluator.evaluate(offshoreOem, GERMAN_OEM, NAME).allowed()).isTrue();
        assertThat(PolicyEvaluator.evaluate(offshoreOem, NORWAY_OEM, NAME).reason()).isEqualTo("no verified DNV certification");
        assertThat(PolicyEvaluator.evaluate(offshoreOem, SPANISH_SUPPLIER, NAME).reason())
                .isEqualTo("role SUPPLIER, but the policy needs role OEM");
    }

    @Test
    void roleListsAndNegation() {
        var noCompetitors = List.of(new Constraint("MembershipCredential.role", "isNoneOf", "SUPPLIER"));
        assertThat(PolicyEvaluator.evaluate(noCompetitors, GERMAN_OEM, NAME).allowed()).isTrue();
        assertThat(PolicyEvaluator.evaluate(noCompetitors, SPANISH_SUPPLIER, NAME).allowed()).isFalse();
        var oemOrService = List.of(new Constraint("MembershipCredential.role", "isAnyOf", "OEM,SERVICE"));
        assertThat(PolicyEvaluator.evaluate(oemOrService, NORWAY_OEM, NAME).allowed()).isTrue();
        assertThat(PolicyEvaluator.evaluate(oemOrService, SPANISH_SUPPLIER, NAME).reason())
                .isEqualTo("role SUPPLIER, but the policy needs role one of OEM, SERVICE");
    }

    @Test
    void relationsAreRelativeToTheOwner() {
        var bilateral = List.of(new Constraint("SupplierRelationCredential.partner", "eq", "BPN-OWNER"));
        var project = List.of(new Constraint("SupplierRelationCredential.project", "eq", "BPN-OWNER"));
        assertThat(PolicyEvaluator.evaluate(bilateral, NORWAY_OEM, NAME).allowed()).isTrue();
        assertThat(PolicyEvaluator.evaluate(bilateral, GERMAN_OEM, NAME).reason()).isEqualTo("no supply relation with Owner");
        assertThat(PolicyEvaluator.evaluate(project, SPANISH_SUPPLIER, NAME).allowed()).isTrue();
    }

    @Test
    void noCredentialsNoAccess() {
        var any = List.of(new Constraint("MembershipCredential", "eq", "active"));
        assertThat(PolicyEvaluator.evaluate(any, Claims.NONE, NAME).allowed()).isFalse();
        assertThat(PolicyEvaluator.evaluate(any, GERMAN_OEM, NAME).reason()).isEqualTo("consortium membership");
    }
}
