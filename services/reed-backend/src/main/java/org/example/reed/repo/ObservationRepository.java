/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.Observation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface ObservationRepository extends JpaRepository<Observation, Long> {

    List<Observation> findTop100ByParticipantOrderByCreatedAtDesc(String participant);

    List<Observation> findByParticipantAndCreatedAtAfterOrderByCreatedAtDesc(String participant, Instant after);
}
