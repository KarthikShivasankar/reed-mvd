/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy.odrl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.example.reed.policy.odrl.PolicyNode.All;
import org.example.reed.policy.odrl.PolicyNode.Atom;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * ODRL (JSON) <-> {@link PolicyNode}, for the subset REED supports: one permission whose constraint
 * is a single constraint, {@code {"and": [...]}} (nested allowed) or a plain array (ODRL: all must hold).
 * Anything else - {@code or}, {@code xone}, {@code andSequence}, an unknown left operand or operator,
 * several permissions - is rejected with a message rather than silently ignored: a policy REED cannot
 * translate must not look enforced.
 */
public final class OdrlParser {

    private OdrlParser() {
    }

    public static PolicyNode parse(JsonNode odrl) {
        var permissions = odrl.path("permission");
        if (permissions.isObject()) {
            return node(permissions.path("constraint"));
        }
        if (permissions.size() != 1) {
            throw new IllegalArgumentException("exactly one permission is supported, found " + permissions.size());
        }
        return node(permissions.get(0).path("constraint"));
    }

    /** The constraints of every permission, flattened (for callers that only need the atoms). */
    public static List<Atom> atoms(JsonNode odrl) {
        return PolicyNode.atoms(parse(odrl));
    }

    private static PolicyNode node(JsonNode c) {
        if (c.isMissingNode() || c.isNull()) {
            return new All(List.of());
        }
        if (c.isArray()) {
            var children = new ArrayList<PolicyNode>();
            c.forEach(x -> children.add(node(x)));
            return new All(children);
        }
        for (var logical : List.of("or", "xone", "andSequence", "not")) {
            if (c.has(logical)) {
                throw new IllegalArgumentException("ODRL '" + logical + "' is not supported yet (only 'and')");
            }
        }
        if (c.has("and")) {
            return node(c.get("and"));
        }
        var kind = ConstraintKind.of(c.path("leftOperand").asText());
        var op = c.path("operator").asText("eq");
        if (!kind.operators.contains(op.toLowerCase(Locale.ROOT))) {
            throw new IllegalArgumentException("operator '" + op + "' is not supported for " + kind.leftOperand);
        }
        var right = c.path("rightOperand");
        var raw = right.isArray() ? String.join(",", texts(right)) : right.path("@value").asText(right.asText());
        var many = op.equalsIgnoreCase("isAnyOf") || op.equalsIgnoreCase("isNoneOf");
        var values = many ? Arrays.stream(raw.split(",")).map(String::strip).filter(s -> !s.isEmpty()).toList() : List.of(raw.strip());
        if (values.isEmpty() || values.get(0).isEmpty()) {
            throw new IllegalArgumentException(kind.leftOperand + " needs a right operand");
        }
        if (kind == ConstraintKind.TIME) {
            try {
                java.time.Instant.parse(values.get(0));
            } catch (java.time.DateTimeException e) {
                // Rego's time.parse_rfc3339_ns would be undefined: the condition could never hold
                throw new IllegalArgumentException("odrl:dateTime needs a timestamp like 2027-01-31T23:59:59Z, got '" + values.get(0) + "'");
            }
        }
        if ((kind == ConstraintKind.COMPETITOR || kind == ConstraintKind.PILOT) && !values.get(0).equals("true") && !values.get(0).equals("false")) {
            throw new IllegalArgumentException(kind.leftOperand + " is true or false, got '" + values.get(0) + "'");
        }
        return new Atom(kind, op, values);
    }

    private static List<String> texts(JsonNode array) {
        var out = new ArrayList<String>();
        array.forEach(x -> out.add(x.asText()));
        return out;
    }

    /** The ODRL constraint of a policy tree: always an explicit {@code and}, so the logic is visible. */
    public static ObjectNode constraint(PolicyNode node) {
        var f = JsonNodeFactory.instance;
        var and = f.arrayNode();
        for (var a : PolicyNode.atoms(node)) {
            and.add(f.objectNode().put("leftOperand", a.kind().leftOperand).put("operator", a.operator())
                    .put("rightOperand", String.join(",", a.values())));
        }
        return f.objectNode().set("and", and);
    }

    /**
     * A complete ODRL policy document.
     *
     * @param type     Offer (a provider's terms) or Agreement (the contract's effective policy)
     * @param assignee null for an Offer
     */
    public static ObjectNode document(String type, String uid, String assigner, String assignee, String target, PolicyNode node) {
        var f = JsonNodeFactory.instance;
        var permission = f.objectNode().put("action", "use");
        if (target != null) {
            permission.put("target", target);
        }
        permission.set("constraint", constraint(node));
        var doc = f.objectNode().put("@context", "http://www.w3.org/ns/odrl.jsonld").put("@type", type).put("uid", uid);
        if (assigner != null) {
            doc.put("assigner", assigner);
        }
        if (assignee != null) {
            doc.put("assignee", assignee);
        }
        doc.set("permission", f.arrayNode().add(permission));
        doc.set("prohibition", f.arrayNode().add(f.objectNode().put("action", "distribute")));
        doc.set("obligation", f.arrayNode().add(f.objectNode().put("action", "reed:audit")));
        return doc;
    }
}
