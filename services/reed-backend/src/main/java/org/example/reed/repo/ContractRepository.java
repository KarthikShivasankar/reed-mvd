/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.Contract;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ContractRepository extends JpaRepository<Contract, String> {

    List<Contract> findAllByOrderByCreatedAtDesc();

    List<Contract> findByConsumerBpnOrProviderBpnOrderByCreatedAtDesc(String consumerBpn, String providerBpn);

    /** The newest contract of a buyer for a provider's asset among the given states. */
    Optional<Contract> findFirstByAssetIdAndConsumerBpnAndStatusInOrderByCreatedAtDesc(String assetId, String consumerBpn,
                                                                                    java.util.Collection<Contract.Status> status);

    List<Contract> findByAssetIdAndConsumerBpnAndStatusOrderByCreatedAtDesc(String assetId, String consumerBpn, Contract.Status status);

    Optional<Contract> findFirstByRfqIdAndOfferingIdOrderByCreatedAtDesc(String rfqId, String offeringId);
}
