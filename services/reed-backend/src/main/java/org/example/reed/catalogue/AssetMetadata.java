/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.catalogue;

import org.example.reed.domain.AssetClass;
import org.example.reed.domain.Discoverability;
import org.example.reed.domain.Sensitivity;

/**
 * Public metadata for an asset - everything that may be published to the
 * catalogue. Deliberately carries no payload: the confidential submodel stays
 * in the submodel service until a contract is accepted.
 */
public record AssetMetadata(
        String assetId,
        AssetClass assetClass,
        String title,
        String description,
        Sensitivity sensitivity,
        Discoverability discoverability,
        String policyTemplate,
        String ownerBpn) {
}
