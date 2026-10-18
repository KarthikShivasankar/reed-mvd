/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Table {@code reed_asset}: one concrete data asset owned by one participant.
 * Sensitivity / discoverability / policy template default to the classification
 * matrix row of its class but may be overridden per asset. The confidential
 * {@code payload} is only ever served by the submodel service to the owner's
 * data plane after a contract - never by the catalogue APIs.
 */
@Entity
@Table(name = "reed_asset")
public class Asset {

    @Id
    public String assetId;

    @Enumerated(EnumType.STRING)
    public AssetClass assetClass;

    public String ownerBpn;

    public String title;

    @Column(length = 1024)
    public String description;

    @Enumerated(EnumType.STRING)
    public Sensitivity sensitivity;

    @Enumerated(EnumType.STRING)
    public Discoverability discoverability;

    public String policyTemplate;

    @JsonIgnore
    @JdbcTypeCode(SqlTypes.JSON)
    public String payload;

    protected Asset() {
    }

    public Asset(String assetId, AssetClass assetClass, String ownerBpn) {
        this.assetId = assetId;
        this.assetClass = assetClass;
        this.ownerBpn = ownerBpn;
    }
}
