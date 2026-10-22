/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.factory;

import org.example.reed.factory.TrendAnalyzer.Baseline;
import org.example.reed.factory.TrendAnalyzer.Point;
import org.example.reed.factory.TrendAnalyzer.Status;
import org.example.reed.participant.Roster;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FactoryAnalysisTest {

    private static final Roster.SensorSpec VIB = new Roster.SensorSpec("spindle-vibration", "Spindle vibration", "mm/s",
            null, 7.1, "Inspect spindle bearings");
    private static final Roster.MachineSpec CNC = new Roster.MachineSpec("fettling-1", "Fettling CNC", List.of(VIB));
    private static final Roster.MachineSpec FURNACE = new Roster.MachineSpec("furnace-1", "Induction furnace 1", List.of(
            new Roster.SensorSpec("shell-temp", "Shell temperature", "°C", null, 140.0, "Inspect refractory lining")));
    private static final Baseline BASE = new Baseline(2.2, 0.3, 10_000);

    /** One point per minute for {@code minutes}, starting at {@code start} and changing by {@code perHour}. */
    private static List<Point> series(double start, double perHour, int minutes) {
        var out = new ArrayList<Point>();
        for (int i = 0; i < minutes; i++) {
            out.add(new Point(i * 60_000L, start + perHour * i / 60.0));
        }
        return out;
    }

    private static TrendAnalyzer.Insight analyse(List<Point> pts, Baseline base) {
        return TrendAnalyzer.analyse("castellum/fettling-1/spindle-vibration", CNC, VIB, pts, base);
    }

    @Test
    void steadySensorIsOk() {
        var i = analyse(series(2.2, 0, 120), BASE);
        assertThat(i.status()).isEqualTo(Status.OK);
        assertThat(i.action()).isNull();
        assertThat(i.finding()).isEqualTo("Spindle vibration steady at 2.20 mm/s.");
    }

    @Test
    void risingTowardsTheLimitWarnsWithTheTimeLeft() {
        // 5.0 -> 6.0 mm/s over 2 h = 0.5 mm/s per hour; 1.1 mm/s left to 7.1 = 2.2 h.
        var i = analyse(series(5.0, 0.5, 121), new Baseline(5.5, 2.0, 10_000));
        assertThat(i.status()).isEqualTo(Status.WARNING);
        assertThat(i.slopePerHour()).isEqualTo(0.5);
        assertThat(i.hoursToLimit()).isEqualTo(2.2);
        assertThat(i.finding()).contains("rising 0.50 mm/s per hour", "7.10 mm/s limit in about 2.20 h");
        assertThat(i.action()).isEqualTo("Inspect spindle bearings");
    }

    @Test
    void slowRiseIsOnlyWatched() {
        // 0.2 mm/s per hour from 3 mm/s: about 20 h to the limit.
        var i = analyse(series(2.6, 0.2, 121), new Baseline(2.8, 1.0, 10_000));
        assertThat(i.status()).isEqualTo(Status.WATCH);
    }

    @Test
    void beyondTheLimitIsAnAlarm() {
        var i = TrendAnalyzer.analyse("castellum/furnace-1/shell-temp", FURNACE, FURNACE.sensors().get(0),
                series(143, 0, 30), new Baseline(100, 15, 10_000));
        assertThat(i.status()).isEqualTo(Status.ALARM);
        assertThat(i.finding()).isEqualTo("Shell temperature 143 °C is above its 140 °C limit.");
    }

    @Test
    void farFromItsHistoryWithoutATrend() {
        // flat at 3.4 mm/s: 4 sigma above a 2.2 +- 0.3 history, but no trend towards the limit
        var i = analyse(series(3.4, 0, 120), BASE);
        assertThat(i.status()).isEqualTo(Status.WARNING);
        assertThat(i.z()).isEqualTo(4.0);
        assertThat(i.finding()).contains("4.00 σ above its 7-day mean of 2.20 mm/s");
    }

    @Test
    void silentDeviceIsWatched() {
        var i = analyse(List.of(), BASE);
        assertThat(i.status()).isEqualTo(Status.WATCH);
        assertThat(i.latest()).isNull();
        assertThat(i.finding()).contains("no readings");
    }

    @Test
    void tooFewPointsGiveNoTrend() {
        var i = analyse(series(6.5, 5, 5), null);
        assertThat(i.slopePerHour()).isNull();
        assertThat(i.status()).isEqualTo(Status.OK);
    }

    @Test
    void observationsAreTaggedByMachineCategoryAndSeverity() {
        var machines = List.of(CNC, FURNACE);
        var t = ObservationTagger.tag("The fettling CNC spindle sounds rough and noisy since the shift change. Bearing?", machines);
        assertThat(t.machineId()).isEqualTo("fettling-1");
        assertThat(t.category()).isEqualTo("maintenance");
        assertThat(t.severity()).isEqualTo("medium");
        assertThat(t.summary()).isEqualTo("The fettling CNC spindle sounds rough and noisy since the shift change.");

        var fire = ObservationTagger.tag("Smoke coming from under the furnace, area cleared", machines);
        assertThat(fire.machineId()).isEqualTo("furnace-1");
        assertThat(fire.category()).isEqualTo("safety");
        assertThat(fire.severity()).isEqualTo("high");

        var quality = ObservationTagger.tag("Porosity on the last three castings", machines);
        assertThat(quality.machineId()).isNull();
        assertThat(quality.category()).isEqualTo("quality");

        assertThat(ObservationTagger.tag("Pallets restocked", machines))
                .extracting(ObservationTagger.Tag::category, ObservationTagger.Tag::severity).containsExactly("process", "low");
    }
}
