/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy.odrl;

import java.util.ArrayList;
import java.util.List;

/**
 * The normalised policy model between ODRL and Rego: a tree of logical nodes over atomic constraints.
 * {@link All} is what REED evaluates today. {@link Any} and {@link Not} are part of the model so OR/NOT
 * can be added in {@link OdrlParser} and {@link RegoMapper} without changing anything that stores or
 * passes policies around; until then the parser rejects them.
 */
public sealed interface PolicyNode {

    record All(List<PolicyNode> children) implements PolicyNode {
    }

    /** Reserved (ODRL {@code or}): not parsed or mapped yet. */
    record Any(List<PolicyNode> children) implements PolicyNode {
    }

    /** Reserved: not parsed or mapped yet. */
    record Not(PolicyNode child) implements PolicyNode {
    }

    /** One constraint: {@code values} has one entry for eq/neq/gteq/..., several for isAnyOf/isNoneOf. */
    record Atom(ConstraintKind kind, String operator, List<String> values) implements PolicyNode {
        public String value() {
            return values.isEmpty() ? "" : values.get(0);
        }
    }

    /** The atoms of a conjunction, in order (nested {@link All}s flattened). */
    static List<Atom> atoms(PolicyNode node) {
        var out = new ArrayList<Atom>();
        collect(node, out);
        return out;
    }

    private static void collect(PolicyNode node, List<Atom> out) {
        if (node instanceof Atom a) {
            out.add(a);
        } else if (node instanceof All all) {
            all.children().forEach(c -> collect(c, out));
        } else {
            throw new IllegalArgumentException("OR and NOT conditions are not supported yet");
        }
    }

    /** {@code base} AND {@code more}. */
    static PolicyNode and(PolicyNode base, List<Atom> more) {
        var all = new ArrayList<PolicyNode>(atoms(base));
        all.addAll(more);
        return new All(all);
    }
}
