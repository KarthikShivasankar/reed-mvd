/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

/**
 * The eight REED asset classes. Concrete assets ({@code reed_asset}) are
 * instances of a class owned by one participant, e.g.
 * {@code process-capability-castellum}.
 */
public enum AssetClass {
    PartDigitalTwin("Part Digital Twin",
            "Catalog/serialized/bulky part identity, BPN ownership, lifecycle state"),
    BillOfMaterial("Bill of Material",
            "Parent/child part relationships, supplier links"),
    DigitalProductPassport("Digital Product Passport",
            "Materials, recyclability, carbon footprint, compliance"),
    ProcessCapability("Process Capability",
            "Machine envelope, operations, tolerances, lead time"),
    FixtureHandlingStrategy("Fixture & Handling Strategy",
            "Fixture design, lifting/handling constraints, setup"),
    ProductionStatus("Production Status",
            "Capacity, order status, quality gates, delivery"),
    QualityEvidence("Quality Evidence",
            "Inspection reports, certificates, non-conformance"),
    SimulationResult("Simulation Result",
            "Process simulation, energy use, risk/lead-time estimation");

    private final String title;
    private final String description;

    AssetClass(String title, String description) {
        this.title = title;
        this.description = description;
    }

    public String title() {
        return title;
    }

    public String description() {
        return description;
    }

    /** kebab-case form used in ids and resource paths, e.g. "process-capability". */
    public String kebab() {
        return name().replaceAll("([a-z])([A-Z])", "$1-$2").toLowerCase();
    }
}
