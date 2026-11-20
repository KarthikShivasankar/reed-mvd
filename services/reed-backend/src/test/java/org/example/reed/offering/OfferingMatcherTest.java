/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.offering;

import org.example.reed.offering.OfferingMatcher.Check;
import org.example.reed.offering.OfferingMatcher.Demand;
import org.example.reed.offering.OfferingMatcher.Supply;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class OfferingMatcherTest {

    private static final Supply CNC = new Supply("cnc-machining", "Precision CNC Manufacturing", "5-axis milling in titanium",
            List.of("5-axis", "milling", "titanium"), 400, "NO");

    @Test
    void everyCheckIsNamedAndAllMustPass() {
        var checks = OfferingMatcher.checks(new Demand("cnc-machining", List.of("5-Axis", "titanium"), 120, "EEA"), CNC);
        assertThat(checks).extracting(Check::key).containsExactly("capability", "keywords", "capacity", "region");
        assertThat(OfferingMatcher.matches(checks)).isTrue();
    }

    @Test
    void eachRequirementCanFailOnItsOwn() {
        assertThat(failed(new Demand("robot-welding", null, null, null))).containsExactly("capability");
        assertThat(failed(new Demand("cnc-machining", List.of("inconel"), null, null))).containsExactly("keywords");
        assertThat(failed(new Demand("cnc-machining", null, 401, null))).containsExactly("capacity");
        // Norway is in the EEA and Nordic, but not in the EU
        assertThat(failed(new Demand("cnc-machining", null, null, "EU"))).containsExactly("region");
        assertThat(failed(new Demand("cnc-machining", null, null, "NORDIC"))).isEmpty();
        assertThat(failed(new Demand("cnc-machining", null, null, "no"))).isEmpty();
    }

    private static List<String> failed(Demand d) {
        return OfferingMatcher.checks(d, CNC).stream().filter(c -> !c.pass()).map(Check::key).toList();
    }
}
