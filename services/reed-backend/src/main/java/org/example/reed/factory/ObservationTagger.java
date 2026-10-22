/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.factory;

import org.example.reed.participant.Roster;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Rule-based tagging of an operator's plain-language observation: which machine, what kind of issue, how
 * urgent. It is the fallback when the local LLM is unavailable, and the LLM's answer is checked against
 * the same vocabulary (machine ids, categories, severities).
 */
public final class ObservationTagger {

    public static final List<String> CATEGORIES = List.of("safety", "quality", "maintenance", "process");
    public static final List<String> SEVERITIES = List.of("low", "medium", "high");

    public record Tag(String machineId, String category, String severity, String summary) {
    }

    // ponytail: keyword lists; the LLM handles phrasing these miss.
    private static final Pattern HIGH = words("fire", "smoke", "leak", "leaking", "injur\\w*", "burn\\w*", "spill\\w*",
            "stopped", "stop", "alarm", "crack\\w*", "breakout", "explo\\w*", "unsafe", "emergency", "broken");
    private static final Pattern MEDIUM = words("nois\\w*", "vibrat\\w*", "hot", "hotter", "smell\\w*", "unusual", "slow\\w*",
            "drift\\w*", "worn", "wear", "delay\\w*", "rough", "scratch\\w*", "porosity", "defect\\w*", "rattl\\w*", "squeal\\w*");
    private static final Pattern SAFETY = words("fire", "smoke", "injur\\w*", "burn\\w*", "unsafe", "spill\\w*", "guard\\w*",
            "ppe", "emergency", "explo\\w*", "slip\\w*");
    private static final Pattern QUALITY = words("defect\\w*", "porosity", "crack\\w*", "scratch\\w*", "tolerance", "dimension\\w*",
            "flatness", "scrap", "rework", "inclusion\\w*", "out of spec", "deviation\\w*", "surface");
    private static final Pattern MAINTENANCE = words("vibrat\\w*", "nois\\w*", "bearing\\w*", "lubric\\w*", "worn", "wear", "leak\\w*",
            "oil", "filter\\w*", "belt\\w*", "rattl\\w*", "squeal\\w*", "refractory", "lining", "spindle", "coolant", "chiller");
    /** Words in machine names that do not identify one machine. */
    private static final Set<String> GENERIC = Set.of("line", "cell", "machine", "the", "and", "unit");

    private ObservationTagger() {
    }

    public static Tag tag(String text, List<Roster.MachineSpec> machines) {
        var t = text == null ? "" : text.toLowerCase(Locale.ROOT);
        var severity = HIGH.matcher(t).find() ? "high" : MEDIUM.matcher(t).find() ? "medium" : "low";
        var category = SAFETY.matcher(t).find() ? "safety" : QUALITY.matcher(t).find() ? "quality"
                : MAINTENANCE.matcher(t).find() ? "maintenance" : "process";
        return new Tag(machine(t, machines), category, severity, summary(text));
    }

    /** The machine whose id, name words or sensor names occur most often in the text (null if none). */
    static String machine(String lower, List<Roster.MachineSpec> machines) {
        String best = null;
        int bestScore = 0;
        for (var m : machines) {
            int score = lower.contains(m.id().toLowerCase(Locale.ROOT)) ? 3 : 0;
            for (var w : m.name().toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{N}]+")) {
                if (w.length() >= 3 && !GENERIC.contains(w) && !w.chars().allMatch(Character::isDigit)
                        && Pattern.compile("\\b" + Pattern.quote(w)).matcher(lower).find()) {
                    score += 2;
                }
            }
            for (var s : m.sensors()) {
                for (var w : s.name().toLowerCase(Locale.ROOT).split("\\s+")) {
                    if (w.length() >= 4 && lower.contains(w)) {
                        score += 1;
                    }
                }
            }
            if (score > bestScore) {
                best = m.id();
                bestScore = score;
            }
        }
        return best;
    }

    /** First sentence, at most 140 characters. */
    static String summary(String text) {
        if (text == null) {
            return "";
        }
        var first = text.strip().split("(?<=[.!?])\\s+", 2)[0];
        return first.length() <= 140 ? first : first.substring(0, 137) + "...";
    }

    private static Pattern words(String... ws) {
        return Pattern.compile("\\b(?:" + String.join("|", ws) + ")\\b");
    }
}
