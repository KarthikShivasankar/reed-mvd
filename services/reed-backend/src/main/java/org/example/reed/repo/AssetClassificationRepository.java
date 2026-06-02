/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.AssetClass;
import org.example.reed.domain.AssetClassification;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AssetClassificationRepository extends JpaRepository<AssetClassification, AssetClass> {
}
