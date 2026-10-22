/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Function;

/**
 * Pure mirror of the connectors' CEL rules (deterministic, unit-tested): decides a credential-constrained
 * EDC policy against one requester's claims - the same claims the issuer puts in its verifiable credentials
 * (the {@code vc_*} views). REED uses it to show an owner who would get an asset before anyone asks; the
 * connectors stay the authority, and {@code run-interop.sh} checks that both agree for every company pair.
 */
public final class PolicyEvaluator {

    /** What a requester's credentials say; {@code member == false}: no credentials at all. */
    public record Claims(boolean member, String role, String country, Set<String> certifications,
                         Set<String> partners, Set<String> projects) {
        public static final Claims NONE = new Claims(false, null, null, Set.of(), Set.of(), Set.of());
    }

    public record Constraint(String leftOperand, String operator, String rightOperand) {
    }

    /** {@code reason}: why not (the first unmet constraint), or what was proven. */
    public record Decision(boolean allowed, String reason) {
    }

    private PolicyEvaluator() {
    }

    /** All constraints must hold (EDC: a permission's constraints are AND-ed). {@code name}: BPN -> display name. */
    public static Decision evaluate(List<Constraint> constraints, Claims c, Function<String, String> name) {
        if (!c.member()) {
            return new Decision(false, "no verifiable credentials (not a consortium member)");
        }
        var proven = new LinkedHashSet<String>();
        for (var k : constraints) {
            var unmet = unmet(k, c, name);
            if (unmet != null) {
                return new Decision(false, unmet);
            }
            proven.add(describe(k, name));
        }
        return new Decision(true, proven.isEmpty() ? "no constraints" : String.join("; ", proven));
    }

    /** null if the constraint holds, else a readable reason. */
    private static String unmet(Constraint k, Claims c, Function<String, String> name) {
        var r = k.rightOperand();
        return switch (k.leftOperand()) {
            case "MembershipCredential" -> null;  // member == true: an active membership credential
            case "MembershipCredential.role" -> matches(k.operator(), c.role(), r) ? null
                    : "role " + c.role() + ", but the policy needs " + describe(k, name);
            case "MembershipCredential.country" -> matches(k.operator(), c.country(), r) ? null
                    : "registered in " + c.country() + ", but the policy needs " + describe(k, name);
            case "CertificationCredential.certification" -> c.certifications().contains(r) ? null
                    : "no verified " + r + " certification";
            case "SupplierRelationCredential.partner" -> c.partners().contains(r) ? null
                    : "no supply relation with " + name.apply(r);
            case "SupplierRelationCredential.project" -> c.projects().contains(r) ? null
                    : "no shared project with " + name.apply(r);
            default -> "unknown constraint " + k.leftOperand();
        };
    }

    /** Same semantics as the CEL rules: eq, neq, isAnyOf, isNoneOf over a comma-separated list. */
    static boolean matches(String operator, String value, String right) {
        if (value == null) {
            return false;
        }
        var list = list(right);
        return switch (operator.toLowerCase(Locale.ROOT)) {
            case "neq" -> !value.equals(right);
            case "isanyof" -> list.contains(value);
            case "isnoneof" -> !list.contains(value);
            default -> value.equals(right);
        };
    }

    /** What a constraint asks for, in words. */
    public static String describe(Constraint k, Function<String, String> name) {
        var r = k.rightOperand();
        var op = k.operator().toLowerCase(Locale.ROOT);
        return switch (k.leftOperand()) {
            case "MembershipCredential" -> "consortium membership";
            case "MembershipCredential.role" -> "role " + words(op, r);
            case "MembershipCredential.country" -> "registered seat " + countries(op, r);
            case "CertificationCredential.certification" -> "verified " + r + " certification";
            case "SupplierRelationCredential.partner" -> "a supply relation with " + name.apply(r);
            case "SupplierRelationCredential.project" -> "a shared project with " + name.apply(r);
            default -> k.leftOperand() + " " + k.operator() + " " + r;
        };
    }

    private static String words(String op, String r) {
        return switch (op) {
            case "neq" -> "other than " + r;
            case "isanyof" -> "one of " + String.join(", ", list(r));
            case "isnoneof" -> "none of " + String.join(", ", list(r));
            default -> r;
        };
    }

    private static String countries(String op, String r) {
        var l = list(r);
        var region = l.containsAll(EU27) && l.size() == EU27.size() ? "the EU"
                : l.containsAll(EU27) && l.containsAll(EEA_EFTA) && l.size() == EU27.size() + EEA_EFTA.size() ? "the EU/EEA"
                : null;
        if (region != null) {
            return op.equals("isnoneof") ? "outside " + region : "in " + region;
        }
        return switch (op) {
            case "neq" -> "outside " + r;
            case "isanyof" -> "in " + String.join(", ", l);
            case "isnoneof" -> "outside " + String.join(", ", l);
            default -> "in " + r;
        };
    }

    private static List<String> list(String r) {
        return r == null ? List.of() : Arrays.stream(r.split(",")).map(String::strip).filter(s -> !s.isEmpty()).toList();
    }

    /** EU member states (ISO 3166-1 alpha-2; Greece as GR). */
    public static final List<String> EU27 = List.of("AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
            "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE");
    /** The EEA's EFTA states: with the EU27 they form the European Economic Area. */
    public static final List<String> EEA_EFTA = List.of("IS", "LI", "NO");
}
