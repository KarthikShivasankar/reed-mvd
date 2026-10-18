/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.MatchRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface MatchRepository extends JpaRepository<MatchRecord, Long> {

    List<MatchRecord> findByRfqId(String rfqId);

    Optional<MatchRecord> findByRfqIdAndSupplierBpn(String rfqId, String supplierBpn);

    List<MatchRecord> findBySupplierBpn(String supplierBpn);

    List<MatchRecord> findByBuyerBpnOrSupplierBpnOrderByUpdatedAtDesc(String buyerBpn, String supplierBpn);
}
