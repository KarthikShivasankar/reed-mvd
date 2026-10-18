/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.Asset;
import org.example.reed.domain.AssetClass;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AssetRepository extends JpaRepository<Asset, String> {

    List<Asset> findByOwnerBpnOrderByAssetId(String ownerBpn);

    Optional<Asset> findFirstByOwnerBpnAndAssetClass(String ownerBpn, AssetClass assetClass);
}
