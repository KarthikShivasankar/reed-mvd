/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.Rfq;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RfqRepository extends JpaRepository<Rfq, String> {

    List<Rfq> findByStateOrderByCreatedAtDesc(Rfq.State state);

    List<Rfq> findAllByOrderByCreatedAtDesc();
}
