/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.Participant;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ParticipantRepository extends JpaRepository<Participant, String> {

    boolean existsByBpnAndConsortiumTrue(String bpn);

    Optional<Participant> findByConnectorName(String connectorName);

    Optional<Participant> findByDid(String did);
}
