/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.PolicyDecision;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PolicyDecisionRepository extends JpaRepository<PolicyDecision, Long> {

    List<PolicyDecision> findTop300ByOrderByAtDesc();

    /** A company's own requests, and as provider everything but other buyers' matchmaking-time eligibility. */
    @org.springframework.data.jpa.repository.Query("select d from PolicyDecision d where d.requesterBpn = :bpn "
            + "or (d.providerBpn = :bpn and d.stage <> 'MATCH') order by d.at desc")
    List<PolicyDecision> visibleTo(@org.springframework.data.repository.query.Param("bpn") String bpn,
                                   org.springframework.data.domain.Pageable page);

    List<PolicyDecision> findByContractIdOrderByAtDesc(String contractId);
}
