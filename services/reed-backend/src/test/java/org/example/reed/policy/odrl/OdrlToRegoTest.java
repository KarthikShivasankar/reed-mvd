/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy.odrl;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.policy.PolicyEvaluator;
import org.example.reed.policy.odrl.PolicyNode.Atom;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OdrlToRegoTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Function<String, String> NAME = bpn -> bpn.equals("BPN-A") ? "Buyer A" : bpn;
    private static final String EEA;
    static {
        var l = new ArrayList<>(PolicyEvaluator.EU27);
        l.addAll(PolicyEvaluator.EEA_EFTA);
        EEA = String.join(",", l);
    }

    /** The demonstration policy: OEM, active member, EU/EEA, not a competitor, pilot only. */
    static final String NORDIC = "{\"permission\":[{\"action\":\"use\",\"constraint\":{\"and\":["
            + "{\"leftOperand\":\"MembershipCredential.role\",\"operator\":\"eq\",\"rightOperand\":\"OEM\"},"
            + "{\"leftOperand\":\"MembershipCredential\",\"operator\":\"eq\",\"rightOperand\":\"active\"},"
            + "{\"leftOperand\":\"MembershipCredential.country\",\"operator\":\"isAnyOf\",\"rightOperand\":\"" + EEA + "\"},"
            + "{\"leftOperand\":\"reed:competitor\",\"operator\":\"eq\",\"rightOperand\":\"false\"},"
            + "{\"leftOperand\":\"reed:pilotProject\",\"operator\":\"eq\",\"rightOperand\":\"true\"}]}}]}";

    @Test
    void compoundPolicyBecomesOneRulePerCondition() throws Exception {
        var policy = OdrlParser.parse(JSON.readTree(NORDIC));
        assertThat(PolicyNode.atoms(policy)).extracting(Atom::kind).containsExactly(ConstraintKind.ORG_TYPE,
                ConstraintKind.MEMBERSHIP, ConstraintKind.REGION, ConstraintKind.COMPETITOR, ConstraintKind.PILOT);

        var rego = RegoMapper.toRego("offering-precision-cnc-nordic", policy, null, NAME);
        assertThat(rego).doesNotContain("c6 if")  // the policy names membership itself: not added twice
                .contains("package reed.policy.p_offering_precision_cnc_nordic")
                .contains("default c1 := false\n\nc1 if {\n    input.requester.orgType == \"OEM\"\n}")
                .contains("input.requester.membership == \"ACTIVE\"")
                .contains("input.requester.country in {\"AT\", \"BE\"")
                .contains("input.requester.competitor == false")
                .contains("input.contract.pilot == true")
                .contains("{\"id\": \"c1\", \"kind\": \"ORG_TYPE\", \"label\": \"Requester is an OEM\", \"pass\": c1}")
                .contains("\"label\": \"Requester is located in the EU/EEA\"")
                .contains("\"label\": \"Requester is not a competing organisation\"")
                // offering policy at runtime: any active contract, there is none without REED
                .contains("c0 if {\n    input.contract.status == \"ACTIVE\"\n}");
        write("offering.rego", rego);
    }

    @Test
    void contractAddsBuyerWindowAndPurposeAndIsBoundToItsContract() throws Exception {
        var effective = PolicyNode.and(OdrlParser.parse(JSON.readTree(NORDIC)), List.of(
                new Atom(ConstraintKind.CONSUMER, "eq", List.of("BPN-A")),
                new Atom(ConstraintKind.TIME, "gteq", List.of("2026-12-01T00:00:00Z")),
                new Atom(ConstraintKind.TIME, "lteq", List.of("2027-03-01T00:00:00Z")),
                new Atom(ConstraintKind.PURPOSE, "eq", List.of("pilot-evaluation"))));
        var rego = RegoMapper.toRego("c-7f3a", effective, "c-7f3a", NAME);
        assertThat(rego).contains("input.requester.bpn == \"BPN-A\"")
                .contains("\"label\": \"Requester is Buyer A\"")
                .contains("time.parse_rfc3339_ns(input.now) >= time.parse_rfc3339_ns(\"2026-12-01T00:00:00Z\")")
                .contains("time.parse_rfc3339_ns(input.now) <= time.parse_rfc3339_ns(\"2027-03-01T00:00:00Z\")")
                .contains("input.purpose == \"pilot-evaluation\"")
                .contains("input.contract.id == \"c-7f3a\"\n    input.contract.status == \"ACTIVE\"");
        write("contract.rego", rego);

        // the effective policy round-trips through ODRL with an explicit "and"
        var odrl = OdrlParser.document("Agreement", "c-7f3a", "BPN-P", "BPN-A", "asset-1", effective);
        assertThat(odrl.at("/permission/0/constraint/and").size()).isEqualTo(9);
        assertThat(OdrlParser.parse(odrl)).isEqualTo(new PolicyNode.All(new ArrayList<>(PolicyNode.atoms(effective))));
    }

    @Test
    void aPlainConstraintArrayIsAConjunctionSoTheExistingTemplatesTranslate() throws Exception {
        var flat = JSON.readTree("{\"permission\":[{\"action\":\"use\",\"constraint\":["
                + "{\"leftOperand\":\"MembershipCredential.role\",\"operator\":\"isNoneOf\",\"rightOperand\":\"SUPPLIER\"},"
                + "{\"leftOperand\":\"CertificationCredential.certification\",\"operator\":\"eq\",\"rightOperand\":\"DNV\"}]}]}");
        var rego = RegoMapper.toRego("t", OdrlParser.parse(flat), null, NAME);
        // a missing attribute must fail a negated condition too
        assertThat(rego).contains("c1 if {\n    v := input.requester.orgType\n    not v in {\"SUPPLIER\"}\n}")
                .contains("\"DNV\" in input.requester.certifications")
                // membership is enforced even when the provider's policy does not ask for it
                .contains("c3 if {\n    input.requester.membership == \"ACTIVE\"\n}")
                .contains("{\"id\": \"c3\", \"kind\": \"MEMBERSHIP\"");
        write("flat.rego", rego);
    }

    @Test
    void whatCannotBeTranslatedIsRejectedNotIgnored() {
        assertThatThrownBy(() -> OdrlParser.parse(JSON.readTree(
                "{\"permission\":[{\"action\":\"use\",\"constraint\":{\"or\":[]}}]}")))
                .hasMessageContaining("'or' is not supported yet");
        assertThatThrownBy(() -> OdrlParser.parse(JSON.readTree(
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"odrl:spatial\",\"operator\":\"eq\",\"rightOperand\":\"EU\"}]}]}")))
                .hasMessageContaining("unsupported ODRL left operand 'odrl:spatial'");
        assertThatThrownBy(() -> OdrlParser.parse(JSON.readTree(
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"reed:competitor\",\"operator\":\"isAnyOf\",\"rightOperand\":\"false\"}]}]}")))
                .hasMessageContaining("operator 'isAnyOf' is not supported");
        assertThatThrownBy(() -> OdrlParser.parse(JSON.readTree("{\"permission\":[]}"))).hasMessageContaining("exactly one permission");
        // a value the Rego could never evaluate would make the condition silently unsatisfiable
        assertThatThrownBy(() -> OdrlParser.parse(JSON.readTree(
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"odrl:dateTime\",\"operator\":\"lteq\",\"rightOperand\":\"2026-12-31\"}]}]}")))
                .hasMessageContaining("needs a timestamp");
        assertThatThrownBy(() -> OdrlParser.parse(JSON.readTree(
                "{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"reed:pilotProject\",\"operator\":\"eq\",\"rightOperand\":\"yes\"}]}]}")))
                .hasMessageContaining("is true or false");
    }

    @Test
    void valuesCannotBreakOutOfTheirStringLiteral() throws Exception {
        var evil = JSON.readTree("{\"permission\":[{\"action\":\"use\",\"constraint\":[{\"leftOperand\":\"odrl:purpose\","
                + "\"operator\":\"eq\",\"rightOperand\":\"x\\\"\\n}\\nallow := true #\"}]}]}");
        var rego = RegoMapper.toRego("p\nallow := true", OdrlParser.parse(evil), null, NAME);
        assertThat(rego).contains("input.purpose == \"x\\\"\\u000a}\\u000aallow := true #\"")
                .contains("package reed.policy.p_p_allow____true\n");
        write("escaped.rego", rego);
    }

    /** Kept under build/ so {@code opa check} can be run over what the mapper really emits (run-policy.sh does). */
    private static void write(String file, String rego) throws Exception {
        var dir = Files.createDirectories(Path.of("build", "rego"));
        Files.writeString(dir.resolve(file), rego);
    }
}
