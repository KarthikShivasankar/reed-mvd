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
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Table {@code reed_asset_classification}: the classification matrix row for an
 * asset class - its sensitivity, who may discover it, and the default policy
 * template applied to it.
 */
@Entity
@Table(name = "reed_asset_classification")
public class AssetClassification {

    @Id
    @Enumerated(EnumType.STRING)
    @Column(name = "asset_class")
    public AssetClass assetClass;

    @Enumerated(EnumType.STRING)
    public Sensitivity sensitivity;

    @Enumerated(EnumType.STRING)
    public Discoverability discoverability;

    @Column(name = "default_policy_template")
    public String defaultPolicyTemplate;

    protected AssetClassification() {
    }

    public AssetClassification(AssetClass assetClass, Sensitivity sensitivity,
                               Discoverability discoverability, String defaultPolicyTemplate) {
        this.assetClass = assetClass;
        this.sensitivity = sensitivity;
        this.discoverability = discoverability;
        this.defaultPolicyTemplate = defaultPolicyTemplate;
    }
}
