/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.factory;

import org.example.reed.participant.Roster;

import java.util.List;
import java.util.Locale;

/**
 * Pure trend analysis of one sensor (deterministic, unit-tested): where it is relative to its limits and
 * its own 7-day history, where it is heading, and what to do about it.
 * <ul>
 *   <li>ALARM: outside an operating limit now.</li>
 *   <li>WARNING: on course to cross a limit within {@value #WARN_HOURS} h, or {@value #WARN_Z} σ off its history.</li>
 *   <li>WATCH: crossing within {@value #WATCH_HOURS} h, {@value #WATCH_Z} σ off, or no recent readings.</li>
 * </ul>
 * "Now" is the last one-minute average, so a single noisy reading does not raise an alarm.
 */
public final class TrendAnalyzer {

    /** Ordered by severity. */
    public enum Status { OK, WATCH, WARNING, ALARM }

    public record Point(long ts, double value) {
    }

    /** Mean and standard deviation of the sensor's readings over the last 7 days (before the recent window). */
    public record Baseline(double mean, double sd, long n) {
    }

    public record Insight(String sensorKey, String machineId, String machine, String sensorId, String sensor, String unit,
                          Double latest, Double lo, Double hi, Double mean, Double z, Double slopePerHour,
                          Double hoursToLimit, Status status, String finding, String action) {
    }

    static final double WARN_HOURS = 4;
    static final double WATCH_HOURS = 24;
    static final double WARN_Z = 3;
    static final double WATCH_Z = 2;
    private static final int MIN_POINTS_FOR_TREND = 10;
    private static final int MIN_POINTS_FOR_BASELINE = 30;

    private TrendAnalyzer() {
    }

    /** {@code recent}: one-minute averages of the last 2 h, oldest first. */
    public static Insight analyse(String key, Roster.MachineSpec m, Roster.SensorSpec s, List<Point> recent, Baseline base) {
        var unit = s.unit() == null ? "" : s.unit();
        if (recent.isEmpty()) {
            return new Insight(key, m.id(), m.name(), s.id(), s.name(), unit, null, s.lo(), s.hi(), null, null, null, null,
                    Status.WATCH, s.name() + ": no readings in the last 2 h.", "Check that the device is online and publishing.");
        }
        double latest = recent.get(recent.size() - 1).value();
        Double slope = recent.size() >= MIN_POINTS_FOR_TREND ? slopePerHour(recent) : null;
        Double z = base != null && base.n() >= MIN_POINTS_FOR_BASELINE && base.sd() > 0 ? (latest - base.mean()) / base.sd() : null;
        Double eta = hoursToLimit(latest, slope, s.lo(), s.hi());

        Status status;
        String finding;
        if (s.hi() != null && latest > s.hi()) {
            status = Status.ALARM;
            finding = String.format(Locale.ROOT, "%s %s %s is above its %s %s limit.", s.name(), fmt(latest), unit, fmt(s.hi()), unit);
        } else if (s.lo() != null && latest < s.lo()) {
            status = Status.ALARM;
            finding = String.format(Locale.ROOT, "%s %s %s is below its %s %s limit.", s.name(), fmt(latest), unit, fmt(s.lo()), unit);
        } else if (eta != null && eta <= WATCH_HOURS) {
            status = eta <= WARN_HOURS ? Status.WARNING : Status.WATCH;
            var limit = slope > 0 ? s.hi() : s.lo();
            finding = String.format(Locale.ROOT, "%s %s %s, %s %s %s per hour: reaches the %s %s limit in about %s h.",
                    s.name(), fmt(latest), unit, slope > 0 ? "rising" : "falling", fmt(Math.abs(slope)), unit, fmt(limit), unit, fmt(eta));
        } else if (z != null && Math.abs(z) >= WATCH_Z) {
            status = Math.abs(z) >= WARN_Z ? Status.WARNING : Status.WATCH;
            finding = String.format(Locale.ROOT, "%s %s %s is %s σ %s its 7-day mean of %s %s.", s.name(), fmt(latest), unit,
                    fmt(Math.abs(z)), z > 0 ? "above" : "below", fmt(base.mean()), unit);
        } else {
            status = Status.OK;
            finding = String.format(Locale.ROOT, "%s steady at %s %s.", s.name(), fmt(latest), unit);
        }
        return new Insight(key, m.id(), m.name(), s.id(), s.name(), unit, round(latest), s.lo(), s.hi(),
                base == null ? null : round(base.mean()), z == null ? null : round(z), slope == null ? null : round(slope),
                eta == null ? null : round(eta), status, finding, status == Status.OK ? null : s.action());
    }

    /** Least-squares slope in units per hour. */
    static double slopePerHour(List<Point> pts) {
        double n = pts.size();
        double t0 = pts.get(0).ts();
        double sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (var p : pts) {
            double x = (p.ts() - t0) / 3_600_000.0;
            sx += x;
            sy += p.value();
            sxx += x * x;
            sxy += x * p.value();
        }
        double den = n * sxx - sx * sx;
        return den == 0 ? 0 : (n * sxy - sx * sy) / den;
    }

    /** Hours until the trend crosses the limit it is heading for, or null if it is not heading for one. */
    static Double hoursToLimit(double latest, Double slope, Double lo, Double hi) {
        if (slope == null || slope == 0) {
            return null;
        }
        if (slope > 0 && hi != null && latest <= hi) {
            return (hi - latest) / slope;
        }
        if (slope < 0 && lo != null && latest >= lo) {
            return (latest - lo) / -slope;
        }
        return null;
    }

    /** Readable precision: 1450, 85.2, 2.24, 0.031. */
    static String fmt(double v) {
        double a = Math.abs(v);
        var pattern = a >= 100 ? "%.0f" : a >= 10 ? "%.1f" : a >= 0.1 ? "%.2f" : "%.3f";
        return String.format(Locale.ROOT, pattern, v);
    }

    private static double round(double v) {
        return Double.parseDouble(fmt(v));
    }
}
