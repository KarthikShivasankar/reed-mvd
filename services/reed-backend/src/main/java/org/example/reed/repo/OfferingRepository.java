/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.Offering;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface OfferingRepository extends JpaRepository<Offering, String> {

    List<Offering> findAllByOrderByName();

    Optional<Offering> findFirstByAssetId(String assetId);

    boolean existsByPolicyTemplate(String policyTemplate);
}
