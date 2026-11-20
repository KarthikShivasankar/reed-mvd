/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy.odrl;

import org.example.reed.policy.PolicyEvaluator;
import org.example.reed.policy.odrl.PolicyNode.Atom;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The ODRL constraints REED supports. One entry = one constraint kind: its ODRL left operand, the
 * operators it accepts, the Rego statements that test it against the OPA input document and its
 * wording. Adding a manufacturing-specific constraint is one more entry here (plus the attribute in
 * {@code OpaInputBuilder} if the input does not carry it yet).
 *
 * <p>Kinds whose operand is a credential claim are also enforced by the connectors (CEL, at catalogue
 * and negotiation time); the others exist only in OPA.
 */
public enum ConstraintKind {

    ORG_TYPE("MembershipCredential.role", Ops.SET,
            a -> Ops.compare("input.requester.orgType", a),
            (a, name) -> "Requester is " + Ops.words(a, v -> article(v) + " " + v)),

    MEMBERSHIP("MembershipCredential", Set.of("eq"),
            a -> List.of("input.requester.membership == \"ACTIVE\""),
            (a, name) -> "Requester is an active REED consortium member"),

    REGION("MembershipCredential.country", Ops.SET,
            a -> Ops.compare("input.requester.country", a),
            (a, name) -> "Requester is located " + PolicyEvaluator.countries(a.operator().toLowerCase(Locale.ROOT),
                    String.join(",", a.values()))),

    CERTIFICATION("CertificationCredential.certification", Set.of("eq"),
            a -> List.of(RegoMapper.quote(a.value()) + " in input.requester.certifications"),
            (a, name) -> "Requester holds a verified " + a.value() + " certification"),

    /** The right operand names the provider; the input says whether the requester has a relation with it. */
    BILATERAL("SupplierRelationCredential.partner", Set.of("eq"),
            a -> List.of("input.requester.bilateral == true"),
            (a, name) -> "Requester has a bilateral relationship with " + name.apply(a.value())),

    PROJECT("SupplierRelationCredential.project", Set.of("eq"),
            a -> List.of("input.requester.project == true"),
            (a, name) -> "Requester shares a project with " + name.apply(a.value())),

    COMPETITOR("reed:competitor", Set.of("eq"),
            a -> List.of("input.requester.competitor == " + Boolean.parseBoolean(a.value())),
            (a, name) -> Boolean.parseBoolean(a.value()) ? "Requester is a competing organisation"
                    : "Requester is not a competing organisation"),

    TIME("odrl:dateTime", Set.of("gteq", "lteq", "gt", "lt"),
            a -> List.of("time.parse_rfc3339_ns(input.now) " + Ops.SYMBOL.get(a.operator().toLowerCase(Locale.ROOT))
                    + " time.parse_rfc3339_ns(" + RegoMapper.quote(a.value()) + ")"),
            (a, name) -> "Access is " + (a.operator().toLowerCase(Locale.ROOT).startsWith("g") ? "not before " : "not after ")
                    + a.value()),

    /** The engagement the request belongs to (RFQ, then contract) is a pilot project. */
    PILOT("reed:pilotProject", Set.of("eq"),
            a -> List.of("input.contract.pilot == " + Boolean.parseBoolean(a.value())),
            (a, name) -> Boolean.parseBoolean(a.value()) ? "Access is part of a pilot project" : "Access is not part of a pilot project"),

    CONSUMER("reed:consumer", Ops.SET,
            a -> Ops.compare("input.requester.bpn", a),
            (a, name) -> "Requester is " + Ops.words(a, name)),

    PURPOSE("odrl:purpose", Ops.SET,
            a -> Ops.compare("input.purpose", a),
            (a, name) -> "Declared purpose is " + Ops.words(a, v -> v));

    public final String leftOperand;
    final Set<String> operators;
    private final Function<Atom, List<String>> rego;
    private final BiFunction<Atom, Function<String, String>, String> label;

    ConstraintKind(String leftOperand, Set<String> operators, Function<Atom, List<String>> rego,
                   BiFunction<Atom, Function<String, String>, String> label) {
        this.leftOperand = leftOperand;
        this.operators = operators;
        this.rego = rego;
        this.label = label;
    }

    /** The statements of the rule body: all must hold; any undefined input makes the rule false. */
    List<String> rego(Atom a) {
        return rego.apply(a);
    }

    /** The condition in words. {@code name}: BPN -> company name. */
    public String label(Atom a, Function<String, String> name) {
        return label.apply(a, name);
    }

    public static ConstraintKind of(String leftOperand) {
        for (var k : values()) {
            if (k.leftOperand.equals(leftOperand)) {
                return k;
            }
        }
        throw new IllegalArgumentException("unsupported ODRL left operand '" + leftOperand + "'");
    }

    private static String article(String v) {
        return !v.isEmpty() && "AEIOU".indexOf(Character.toUpperCase(v.charAt(0))) >= 0 ? "an" : "a";
    }

    /** Operators shared by the kinds that compare one input value with one value or a set. */
    private static final class Ops {
        static final Set<String> SET = Set.of("eq", "neq", "isanyof", "isnoneof");
        static final java.util.Map<String, String> SYMBOL = java.util.Map.of("gteq", ">=", "lteq", "<=", "gt", ">", "lt", "<");

        static List<String> compare(String ref, Atom a) {
            var set = a.values().stream().map(RegoMapper::quote).collect(Collectors.joining(", ", "{", "}"));
            return switch (a.operator().toLowerCase(Locale.ROOT)) {
                case "neq" -> List.of(ref + " != " + RegoMapper.quote(a.value()));
                case "isanyof" -> List.of(ref + " in " + set);
                // bound first: `not undefined in set` would be true, and a missing attribute must fail
                case "isnoneof" -> List.of("v := " + ref, "not v in " + set);
                default -> List.of(ref + " == " + RegoMapper.quote(a.value()));
            };
        }

        static String words(Atom a, Function<String, String> each) {
            var list = a.values().stream().map(each).collect(Collectors.joining(", "));
            return switch (a.operator().toLowerCase(Locale.ROOT)) {
                case "neq" -> "not " + list;
                case "isanyof" -> a.values().size() == 1 ? list : "one of " + list;
                case "isnoneof" -> "none of " + list;
                default -> list;
            };
        }
    }
}
