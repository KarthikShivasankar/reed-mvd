/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.assistant;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic RFQ extraction from free text: dimensions, mass, tolerance,
 * quantity, lead time, and vocabulary matches (materials, processes,
 * certifications, sectors) against the REED registry. Used as the fallback
 * when no LLM is available, and as the <b>authority for numbers</b> when one
 * is: a language model may mis-read "38 t" - a regex does not.
 */
public final class RuleRfqParser {

    public record Draft(String title, String sector, String partFamily, String material, List<Integer> dimsMm,
                        Double massKg, Double tolMm, Integer quantity, Integer dueInWeeks,
                        List<String> requiredProcesses, List<String> requiredCerts, List<String> partnerProcesses) {
    }

    private static final String NUM = "(\\d+(?:[.,]\\d+)?)";
    private static final Pattern DIMS = Pattern.compile(NUM + "\\s*(mm|m)?\\s*[x×*]\\s*" + NUM + "\\s*(mm|m)?\\s*[x×*]\\s*" + NUM + "\\s*(mm|m)\\b",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern DIAMETER = Pattern.compile("(?:Ø|diameter|dia\\.?)\\s*" + NUM + "\\s*(mm|m)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern MASS = Pattern.compile(NUM + "\\s*(t|tonnes?|tons?|kg)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern TOL = Pattern.compile("(?:±|\\+/-|tolerance(?: of)?|flatness(?: of)?)\\s*" + NUM + "\\s*mm", Pattern.CASE_INSENSITIVE);
    private static final Pattern QTY_EXPLICIT = Pattern.compile(
            "(?:series of|batch of|quantity:?|qty:?)\\s*(\\d{1,5})|(\\d{1,5})\\s*(?:pcs|pieces|units|off)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern QTY_NOUN = Pattern.compile(
            "\\b(\\d{1,5})\\s+(?:x\\s+)?(?:(?!mw\\b|t\\b|kg\\b|m\\b|mm\\b)[a-z-]+\\s+){0,4}?"
                    + "(?:hubs?|frames?|nodes?|shafts?|rings?|flanges?|blocks?|runners?|sections?|castings?|parts?)\\b",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern WEEKS = Pattern.compile("(?:within|in|by)\\s+(\\d+)\\s*weeks?", Pattern.CASE_INSENSITIVE);
    private static final Pattern MONTHS = Pattern.compile("(?:within|in)\\s+(\\d+)\\s*months?", Pattern.CASE_INSENSITIVE);

    private static final List<String[]> SECTORS = List.of(
            new String[]{"wind", "wind", "turbine hub", "nacelle", "tower"},
            new String[]{"offshore", "offshore", "ship", "vessel", "hull", "jacket", "propeller"},
            new String[]{"rail", "rail", "bogie", "locomotive", "railway"},
            new String[]{"hydro", "hydro", "francis", "penstock", "pelton", "kaplan"},
            new String[]{"heavy-machinery", "press", "mining", "excavator", "machine frame"});
    private static final List<String[]> FAMILIES = List.of(
            new String[]{"hub", "hub"}, new String[]{"ring", "ring", "flange", "bearing"},
            new String[]{"hull-block", "hull block"}, new String[]{"node", "node"},
            new String[]{"shaft", "shaft"}, new String[]{"bogie-frame", "bogie"},
            new String[]{"press-frame", "press frame"}, new String[]{"runner", "runner"},
            new String[]{"penstock", "penstock"});
    private static final List<String[]> PROCESS_HINTS = List.of(
            new String[]{"sand-casting", "cast", "foundry", "ductile iron", "cast steel"},
            new String[]{"heat-treatment", "heat treat", "quench", "temper", "stress reliev", "cast", "forg"},
            new String[]{"open-die-forging", "forg"},
            new String[]{"machining-turning", "turn", "vtl", "lathe"},
            new String[]{"machining-milling", "mill", "machin"},
            new String[]{"welding", "weld"},
            new String[]{"hull-block-fabrication", "hull block"},
            new String[]{"plate-rolling", "rolled", "plate rolling", "penstock"});
    private static final List<String[]> PARTNER_HINTS = List.of(
            new String[]{"ndt-ut", "ultrasonic", " ut ", "ut testing", "ndt"},
            new String[]{"ndt-mt", "magnetic particle", " mt "},
            new String[]{"heavy-lift", "heavy lift", "transport", "abnormal load", "spmt"},
            new String[]{"load-out", "load-out", "load out"});

    private RuleRfqParser() {
    }

    public static Draft parse(String text, Collection<String> materials, Collection<String> certs) {
        var t = " " + text + " ";
        var lower = t.toLowerCase(Locale.ROOT);

        List<Integer> dims = null;
        var dm = DIMS.matcher(t);
        if (dm.find()) {
            var unit = dm.group(6);
            dims = List.of(mm(dm.group(1), unit), mm(dm.group(3), unit), mm(dm.group(5), unit));
        } else {
            var dia = DIAMETER.matcher(t);
            if (dia.find()) {
                var d = mm(dia.group(1), dia.group(2));
                dims = List.of(d, d, Math.max(100, d / 20));
            }
        }
        Double mass = null;
        var mm = MASS.matcher(t);
        while (mm.find()) {
            var v = num(mm.group(1));
            mass = mm.group(2).toLowerCase(Locale.ROOT).startsWith("t") ? v * 1000 : v;
            break;
        }
        var tol = first(TOL.matcher(t)).map(RuleRfqParser::num).orElse(null);
        Integer qty = null;
        var qe = QTY_EXPLICIT.matcher(t);
        if (qe.find()) {
            qty = (int) num(qe.group(1) != null ? qe.group(1) : qe.group(2));
        } else {
            qty = first(QTY_NOUN.matcher(t)).map(s -> (int) num(s)).orElse(null);
        }
        Integer weeks = first(WEEKS.matcher(t)).map(s -> (int) num(s))
                .orElse(first(MONTHS.matcher(t)).map(s -> (int) Math.round(num(s) * 4.345)).orElse(null));

        var material = materials.stream().filter(m -> lower.contains(m.toLowerCase(Locale.ROOT)))
                .max((a, b) -> a.length() - b.length()).orElse(materialHint(lower));
        var requiredCerts = new ArrayList<String>();
        for (var c : certs) {
            var key = c.toLowerCase(Locale.ROOT).replace("-", "");
            if (lower.replace("-", "").replace(" ", "").contains(key.replace(" ", ""))) {
                requiredCerts.add(c);
            }
        }
        var sector = hint(lower, SECTORS);
        var family = hint(lower, FAMILIES);
        var processes = hints(lower, PROCESS_HINTS);
        if (processes.contains("open-die-forging")) {
            processes.remove("sand-casting");
        }
        var partners = hints(lower, PARTNER_HINTS);
        var title = text.length() > 80 ? text.substring(0, 77).trim() + "..." : text.trim();
        return new Draft(title, sector, family, material, dims, mass, tol, qty, weeks,
                new ArrayList<>(processes), requiredCerts, new ArrayList<>(partners));
    }

    private static String materialHint(String lower) {
        if (lower.contains("ductile")) {
            return "EN-GJS-400-18-LT";
        }
        if (lower.contains("cast steel")) {
            return "G20Mn5";
        }
        return null;
    }

    private static String hint(String lower, List<String[]> table) {
        for (var row : table) {
            for (int i = 1; i < row.length; i++) {
                if (lower.contains(row[i])) {
                    return row[0];
                }
            }
        }
        return null;
    }

    private static Set<String> hints(String lower, List<String[]> table) {
        var out = new LinkedHashSet<String>();
        for (var row : table) {
            for (int i = 1; i < row.length; i++) {
                if (lower.contains(row[i])) {
                    out.add(row[0]);
                    break;
                }
            }
        }
        return out;
    }

    private static java.util.Optional<String> first(Matcher m) {
        return m.find() ? java.util.Optional.of(m.group(1)) : java.util.Optional.empty();
    }

    private static double num(String s) {
        return Double.parseDouble(s.replace(',', '.'));
    }

    private static int mm(String value, String unit) {
        var v = num(value);
        return (int) Math.round("mm".equalsIgnoreCase(unit) ? v : v * 1000);
    }
}
