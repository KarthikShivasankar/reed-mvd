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

import java.util.List;

/**
 * Table {@code reed_participant}: a member (or known non-member) of the REED
 * dataspace - the company directory that matchmaking, the catalogue layer and
 * the credential issuer all read. Seeded from {@code deployment/roster.json}.
 *
 * <p>{@code attestations} are the certifications a trusted body has attested
 * for this company; the Issuer Service turns them into verifiable credentials
 * (via the {@code vc_*} views). {@code capability} is the public capability
 * claim; participants with a {@code connectorName} run their own EDC connector.
 */
@Entity
@Table(name = "reed_participant")
public class Participant {

    @Id
    public String bpn;

    public String name;

    public String shortName;

    /** OEM, SUPPLIER or SERVICE. */
    public String role;

    public boolean consortium;

    /** A real company used only in invented demo scenarios: nothing about it is a factual claim. */
    public boolean illustrative;

    public String country;

    public String city;

    public String vatId;

    public double lat;

    public double lon;

    public boolean portAccess;

    public boolean railAccess;

    @JdbcTypeCode(SqlTypes.JSON)
    public List<String> sectors;

    /** Docker service name of the participant's EDC connector, or null (directory-only member). */
    public String connectorName;

    /** In-cluster DSP address of the connector, e.g. http://castellum:29194/protocol/2025-1. */
    public String dspUrl;

    /** In-cluster Management API base, e.g. http://castellum:29193/management. */
    public String managementUrl;

    /** The participant's decentralized identifier (also its EDC participant id under DCP). */
    public String did;

    @JdbcTypeCode(SqlTypes.JSON)
    public List<String> attestations;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    public CapabilityClaim capability;

    protected Participant() {
    }

    public Participant(String bpn) {
        this.bpn = bpn;
    }
}
