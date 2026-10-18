/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.assistant;

import java.util.Collection;
import java.util.regex.Pattern;

/**
 * Removes personal data from free text before it reaches the LLM (GDPR data
 * minimisation): e-mail addresses, phone numbers and the caller's own name /
 * username. REED's assistant only needs organisation and part data.
 */
public final class PersonalDataRedactor {

    private static final Pattern EMAIL = Pattern.compile("[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+");
    /**
     * International (+47 ..., 0049 ...) or space-grouped (030 1234 5678) numbers with at least 8 digits.
     * Plain digit runs (part numbers, serials) and ISO dates are deliberately not treated as phones.
     */
    private static final Pattern PHONE = Pattern.compile(
            "(?<![\\w.+])(?:(?:\\+|00)\\d[\\d ()/-]{6,}\\d|\\(?\\d{2,5}\\)? \\d{2,4} \\d{2,6}(?: \\d{1,6})?)(?![\\w.])");

    public record Result(String text, int redactions) {
    }

    private PersonalDataRedactor() {
    }

    public static Result redact(String text, Collection<String> personNames) {
        if (text == null) {
            return new Result("", 0);
        }
        int[] count = {0};
        var out = replace(EMAIL, text, count, m -> true);
        out = replace(PHONE, out, count, m -> m.replaceAll("\\D", "").length() >= 8);
        for (var name : personNames) {
            if (name != null && name.length() >= 3) {
                var p = Pattern.compile("\\b" + Pattern.quote(name) + "\\b", Pattern.CASE_INSENSITIVE);
                out = replace(p, out, count, m -> true);
            }
        }
        return new Result(out, count[0]);
    }

    private static String replace(Pattern p, String text, int[] count, java.util.function.Predicate<String> accept) {
        var m = p.matcher(text);
        var sb = new StringBuilder();
        while (m.find()) {
            if (!accept.test(m.group())) {
                m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(m.group()));
                continue;
            }
            count[0]++;
            m.appendReplacement(sb, "[person]");
        }
        m.appendTail(sb);
        return sb.toString();
    }
}
