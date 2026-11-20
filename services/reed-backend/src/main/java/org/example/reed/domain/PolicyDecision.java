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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * Table {@code reed_policy_decision}: one Open Policy Agent decision - who asked for what, under which
 * policy, every condition with its outcome and why the answer was ALLOW or DENY. Organisations only,
 * never a person.
 */
@Entity
@Table(name = "reed_policy_decision")
public class PolicyDecision {

    /** MATCH: eligibility during matchmaking; RUNTIME: a real access request at a connector; SIMULATED: a what-if. */
    public enum Stage { MATCH, RUNTIME, SIMULATED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    public Instant at = Instant.now();

    public String stage;

    public String requesterBpn;

    public String providerBpn;

    public String contractId;

    public String offeringId;

    public String rfqId;

    public String assetId;

    public String action;

    public String purpose;

    /** ALLOW or DENY. */
    public String decision;

    public String policyId;

    public String decidedBy;

    /** [{id, kind, label, pass}] as OPA returned them. */
    @JdbcTypeCode(SqlTypes.JSON)
    public String conditions;

    @JdbcTypeCode(SqlTypes.JSON)
    public String failed;

    @Column(length = 2048)
    public String explanation;

    public PolicyDecision() {
    }
}
