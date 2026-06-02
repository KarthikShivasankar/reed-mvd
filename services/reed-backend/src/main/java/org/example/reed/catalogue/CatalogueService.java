/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.catalogue;

import org.example.reed.config.Bpns;
import org.example.reed.config.ReedProperties;
import org.example.reed.domain.AssetClassification;
import org.example.reed.domain.Discoverability;
import org.example.reed.domain.RelationType;
import org.example.reed.domain.SupplyChainRelation;
import org.example.reed.repo.AssetClassificationRepository;
import org.example.reed.repo.SupplyChainRelationRepository;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Implements the REED <b>catalogue layer</b>: decides which asset metadata a
 * given partner BPN may discover, based on the asset's discoverability and the
 * supply-chain graph.
 *
 * <ul>
 *   <li>not a consortium member → discovers nothing;</li>
 *   <li>{@code consortium} → discoverable by any consortium member;</li>
 *   <li>{@code bilateral} → discoverable only with a direct SUPPLIES/OWNS
 *       relation to the owner;</li>
 *   <li>{@code project} → discoverable only with a PROJECT_MEMBER relation.</li>
 * </ul>
 */
@Service
public class CatalogueService {

    private final AssetClassificationRepository classifications;
    private final SupplyChainRelationRepository relations;
    private final ReedProperties props;

    public CatalogueService(AssetClassificationRepository classifications,
                            SupplyChainRelationRepository relations, ReedProperties props) {
        this.classifications = classifications;
        this.relations = relations;
        this.props = props;
    }

    /** All classifications (the full matrix), regardless of visibility. */
    public List<AssetClassification> all() {
        return classifications.findAll();
    }

    /** Metadata visible to {@code requesterBpn} per the catalogue layer. */
    public List<AssetMetadata> visibleTo(String requesterBpn) {
        if (!Bpns.CONSORTIUM.contains(requesterBpn)) {
            return List.of();
        }
        return classifications.findAll().stream()
                .filter(c -> isVisible(c.discoverability, requesterBpn))
                .map(this::toMetadata)
                .toList();
    }

    public AssetMetadata toMetadata(AssetClassification c) {
        return new AssetMetadata(c.assetClass.assetId(), c.assetClass, c.assetClass.title(),
                c.assetClass.description(), c.sensitivity, c.discoverability,
                c.defaultPolicyTemplate, props.getOwnerBpn());
    }

    private boolean isVisible(Discoverability discoverability, String requesterBpn) {
        return switch (discoverability) {
            case consortium -> true; // requester already confirmed a consortium member
            case bilateral -> hasRelation(requesterBpn, RelationType.SUPPLIES, RelationType.OWNS);
            case project -> hasRelation(requesterBpn, RelationType.PROJECT_MEMBER);
        };
    }

    private boolean hasRelation(String requesterBpn, RelationType... types) {
        var owner = props.getOwnerBpn();
        var edges = new java.util.ArrayList<SupplyChainRelation>();
        edges.addAll(relations.findByParentBpnAndChildBpn(owner, requesterBpn));
        edges.addAll(relations.findByParentBpnAndChildBpn(requesterBpn, owner));
        var wanted = List.of(types);
        return edges.stream().map(r -> r.relationType).anyMatch(wanted::contains);
    }
}
