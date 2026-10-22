/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Table {@code reed_observation}: what an operator noticed on the shop floor, in their own words,
 * tagged with the machine, a category and a severity (by the local LLM or by rules). The author stays
 * inside the company's own view; it is never sent to the LLM or over MQTT.
 */
@Entity
@Table(name = "reed_observation")
public class Observation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    /** connector name of the company whose line it is */
    public String participant;

    public String machineId;

    /** safety, quality, maintenance, process */
    public String category;

    /** low, medium, high */
    public String severity;

    @Column(length = 2000)
    public String text;

    @Column(length = 500)
    public String summary;

    /** llm or rules */
    public String source;

    public String author;

    public Instant createdAt;

    protected Observation() {
    }

    public Observation(String participant, String machineId, String category, String severity, String text,
                       String summary, String source, String author) {
        this.participant = participant;
        this.machineId = machineId;
        this.category = category;
        this.severity = severity;
        this.text = text;
        this.summary = summary;
        this.source = source;
        this.author = author;
        this.createdAt = Instant.now();
    }
}
