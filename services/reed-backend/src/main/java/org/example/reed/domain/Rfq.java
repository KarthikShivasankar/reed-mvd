/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * Table {@code reed_rfq}: a buyer's request for quotation - the demand side of
 * matchmaking. Only organisation and part data; the buyer is identified by BPN,
 * never by a person.
 */
@Entity
@Table(name = "reed_rfq")
public class Rfq {

    public enum State { OPEN, AWARDED, CLOSED }

    @Id
    public String id;

    public String buyerBpn;

    public String title;

    @Column(length = 2048)
    public String story;

    /** wind, offshore, rail, heavy-machinery, hydro. */
    public String sector;

    public String partFamily;

    public String material;

    @JdbcTypeCode(SqlTypes.JSON)
    public List<Integer> dimsMm;

    public double massKg;

    public Double tolMm;

    public int quantity;

    public LocalDate dueDate;

    public Double deliveryLat;

    public Double deliveryLon;

    @JdbcTypeCode(SqlTypes.JSON)
    public List<String> requiredProcesses;

    @JdbcTypeCode(SqlTypes.JSON)
    public List<String> requiredCerts;

    @JdbcTypeCode(SqlTypes.JSON)
    public List<String> partnerProcesses;

    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    public State state = State.OPEN;

    public Instant createdAt = Instant.now();

    public Rfq() {
    }
}
