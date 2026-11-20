/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;

/**
 * Table {@code reed_offering}: a manufacturing capability a provider publishes (CNC machining, robot
 * welding, ...) and the resource a contract gives access to (a service, a dataset, an API, machine
 * availability, ...). Its access policy is a compound ODRL policy stored as the policy template
 * {@link #policyTemplate}; when the resource is one of the provider's assets, that asset uses the same
 * template, so the provider's connector enforces the policy's credential constraints too.
 */
@Entity
@Table(name = "reed_offering")
public class Offering {

    @Id
    public String id;

    public String providerBpn;

    public String name;

    /** e.g. cnc-machining, additive-manufacturing, robot-welding, predictive-maintenance. */
    public String capability;

    /** SERVICE, DATASET, API, AVAILABILITY, CAPACITY, PARAMETERS or DIGITAL_TWIN. */
    public String resourceKind;

    /** What the resource is called, e.g. "Real-time machine availability API". */
    public String resource;

    @Column(length = 1024)
    public String description;

    @JdbcTypeCode(SqlTypes.JSON)
    public List<String> keywords = List.of();

    /** Capacity a buyer can book per month, in the provider's unit (machine hours). */
    public Integer capacityPerMonth;

    /** The provider's asset behind the resource (exchanged connector to connector), or null. */
    public String assetId;

    public String policyTemplate;

    public boolean published;

    public Instant createdAt = Instant.now();

    public Instant publishedAt;

    public Offering() {
    }
}
