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
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * Table {@code reed_match}: the lifecycle of one buyer-supplier pairing for an
 * RFQ, created when the buyer shortlists a ranked supplier.
 *
 * <pre>
 * SHORTLISTED (buyer) -> ACCEPTED (supplier consents) -> CONFIRMED (EDC agreement verified,
 *   confidential capability checked)  | DECLINED (supplier) | REJECTED (claim not confirmed)
 * </pre>
 * The score breakdown is snapshotted at shortlist time for auditability.
 * {@code onTime}/{@code qualityOk} feedback feeds the supplier's trust score.
 */
@Entity
@Table(name = "reed_match")
public class MatchRecord {

    public enum State { SHORTLISTED, ACCEPTED, CONFIRMED, DECLINED, REJECTED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    public String rfqId;

    public String buyerBpn;

    public String supplierBpn;

    public double score;

    @JdbcTypeCode(SqlTypes.JSON)
    public String breakdown;

    @Enumerated(EnumType.STRING)
    public State state;

    /** Detail asset (supplier's ProcessCapability) negotiated over EDC. */
    public String detailAssetId;

    public String agreementId;

    @Column(length = 1024)
    public String note;

    public Boolean onTime;

    public Boolean qualityOk;

    public Instant updatedAt = Instant.now();

    protected MatchRecord() {
    }

    public MatchRecord(String rfqId, String buyerBpn, String supplierBpn, double score, String breakdown,
                       State state) {
        this.rfqId = rfqId;
        this.buyerBpn = buyerBpn;
        this.supplierBpn = supplierBpn;
        this.score = score;
        this.breakdown = breakdown;
        this.state = state;
    }
}
