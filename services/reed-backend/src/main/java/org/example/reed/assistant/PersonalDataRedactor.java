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
    private static final Pattern PHONE = Pattern.compile("(?<![\\w.])\\+?\\d[\\d ()/-]{7,}\\d(?![\\w.])");

    public record Result(String text, int redactions) {
    }

    private PersonalDataRedactor() {
    }

    public static Result redact(String text, Collection<String> personNames) {
        if (text == null) {
            return new Result("", 0);
        }
        int[] count = {0};
        var out = replace(EMAIL, text, count);
        out = replace(PHONE, out, count);
        for (var name : personNames) {
            if (name != null && name.length() >= 3) {
                var p = Pattern.compile("\\b" + Pattern.quote(name) + "\\b", Pattern.CASE_INSENSITIVE);
                out = replace(p, out, count);
            }
        }
        return new Result(out, count[0]);
    }

    private static String replace(Pattern p, String text, int[] count) {
        var m = p.matcher(text);
        var sb = new StringBuilder();
        while (m.find()) {
            count[0]++;
            m.appendReplacement(sb, "[person]");
        }
        m.appendTail(sb);
        return sb.toString();
    }
}
