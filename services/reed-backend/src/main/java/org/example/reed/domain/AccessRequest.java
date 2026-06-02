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
 * Table {@code reed_access_request}: a partner's request to negotiate access to
 * an asset (the bridge between catalogue discovery and contract negotiation).
 */
@Entity
@Table(name = "reed_access_request")
public class AccessRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    public String requesterBpn;

    public String assetId;

    @Enumerated(EnumType.STRING)
    public AssetClass assetClass;

    @Enumerated(EnumType.STRING)
    public RequestState state;

    @Column(length = 512)
    public String reason;

    public Instant createdAt;

    protected AccessRequest() {
    }

    public AccessRequest(String requesterBpn, String assetId, AssetClass assetClass,
                         RequestState state, String reason) {
        this.requesterBpn = requesterBpn;
        this.assetId = assetId;
        this.assetClass = assetClass;
        this.state = state;
        this.reason = reason;
        this.createdAt = Instant.now();
    }
}
