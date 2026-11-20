/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.time.LocalDate;

/**
 * Table {@code reed_contract}: the agreement between one buyer and one provider about one offering.
 * It freezes the <em>effective</em> policy - the offering's policy AND this buyer, this period, this
 * purpose - as ODRL, together with the Rego REED generated from it, so what is enforced at runtime is
 * what was agreed, not whatever the offering says later.
 *
 * <pre>
 * DRAFT (buyer selected the provider) -> NEGOTIATING (buyer accepted the terms; connectors negotiate)
 *   -> AGREED (EDC agreement verified) -> ACTIVE (Rego deployed to the provider's policy decision point)
 *   -> EXPIRED (period over) | TERMINATED (by a party or the operator)
 * </pre>
 */
@Entity
@Table(name = "reed_contract")
public class Contract {

    public enum Status { DRAFT, NEGOTIATING, AGREED, ACTIVE, EXPIRED, TERMINATED }

    @Id
    public String id;

    public String rfqId;

    public String offeringId;

    public String providerBpn;

    public String consumerBpn;

    public String assetId;

    public LocalDate startDate;

    public LocalDate expiryDate;

    public String purpose;

    @Column(columnDefinition = "text")
    public String odrl;

    @Column(columnDefinition = "text")
    public String rego;

    public String policyId;

    @Enumerated(EnumType.STRING)
    public Status status = Status.DRAFT;

    public String agreementId;

    public String deployedTo;

    public Instant createdAt = Instant.now();

    public Instant acceptedAt;

    public Instant agreedAt;

    public Instant deployedAt;

    public Instant updatedAt = Instant.now();

    public Contract() {
    }
}
