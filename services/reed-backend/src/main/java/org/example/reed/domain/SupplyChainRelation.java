/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Table {@code reed_supply_chain_relation}: a directed edge between two BPNs.
 * Used by the catalogue layer to decide bilateral / project discoverability.
 */
@Entity
@Table(name = "reed_supply_chain_relation")
public class SupplyChainRelation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    public String parentBpn;

    public String childBpn;

    @Enumerated(EnumType.STRING)
    public RelationType relationType;

    protected SupplyChainRelation() {
    }

    public SupplyChainRelation(String parentBpn, String childBpn, RelationType relationType) {
        this.parentBpn = parentBpn;
        this.childBpn = childBpn;
        this.relationType = relationType;
    }
}
