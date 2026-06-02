/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Table {@code reed_audit_event}: append-only audit log. Every catalogue
 * discovery, access request, negotiation and payload pull is recorded here so
 * access is fully auditable across the three policy layers.
 */
@Entity
@Table(name = "reed_audit_event")
public class AuditEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Enumerated(EnumType.STRING)
    public EventType eventType;

    public String actorBpn;

    public String assetId;

    @Column(length = 1024)
    public String detail;

    public Instant at;

    protected AuditEvent() {
    }

    public AuditEvent(EventType eventType, String actorBpn, String assetId, String detail) {
        this.eventType = eventType;
        this.actorBpn = actorBpn;
        this.assetId = assetId;
        this.detail = detail;
        this.at = Instant.now();
    }
}
