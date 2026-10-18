/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.catalogue;

import org.example.reed.domain.Asset;
import org.example.reed.domain.RelationType;
import org.example.reed.domain.SupplyChainRelation;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.SupplyChainRelationRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Implements the REED <b>catalogue layer</b>: decides which asset metadata a
 * given partner BPN may discover, based on each asset's discoverability and
 * the supply-chain graph between the requester and that asset's owner.
 *
 * <ul>
 *   <li>not a consortium member → discovers nothing;</li>
 *   <li>the owner always sees its own assets;</li>
 *   <li>{@code consortium} → discoverable by any consortium member;</li>
 *   <li>{@code bilateral} → only with a direct SUPPLIES/OWNS relation to the owner;</li>
 *   <li>{@code project} → only with a PROJECT_MEMBER relation to the owner.</li>
 * </ul>
 */
@Service
public class CatalogueService {

    private final AssetRepository assets;
    private final SupplyChainRelationRepository relations;
    private final ParticipantRepository participants;

    public CatalogueService(AssetRepository assets, SupplyChainRelationRepository relations,
                            ParticipantRepository participants) {
        this.assets = assets;
        this.relations = relations;
        this.participants = participants;
    }

    /** Metadata visible to {@code requesterBpn} per the catalogue layer. */
    public List<AssetMetadata> visibleTo(String requesterBpn) {
        if (requesterBpn == null || !participants.existsByBpnAndConsortiumTrue(requesterBpn)) {
            return List.of();
        }
        return assets.findAll().stream()
                .filter(a -> a.ownerBpn.equals(requesterBpn) || isVisible(a, requesterBpn))
                .map(CatalogueService::toMetadata)
                .toList();
    }

    public static AssetMetadata toMetadata(Asset a) {
        return new AssetMetadata(a.assetId, a.assetClass, a.title, a.description, a.sensitivity,
                a.discoverability, a.policyTemplate, a.ownerBpn);
    }

    private boolean isVisible(Asset a, String requesterBpn) {
        return switch (a.discoverability) {
            case consortium -> true; // requester already confirmed a consortium member
            case bilateral -> hasRelation(a.ownerBpn, requesterBpn, RelationType.SUPPLIES, RelationType.OWNS);
            case project -> hasRelation(a.ownerBpn, requesterBpn, RelationType.PROJECT_MEMBER);
        };
    }

    private boolean hasRelation(String owner, String requesterBpn, RelationType... types) {
        var edges = new ArrayList<SupplyChainRelation>();
        edges.addAll(relations.findByParentBpnAndChildBpn(owner, requesterBpn));
        edges.addAll(relations.findByParentBpnAndChildBpn(requesterBpn, owner));
        var wanted = List.of(types);
        return edges.stream().map(r -> r.relationType).anyMatch(wanted::contains);
    }
}
