/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

/** Auditable event types across the three policy layers. */
public enum EventType {
    /** an asset class was classified (seeded). */
    CLASSIFY,
    /** a partner queried the catalogue (catalogue layer). */
    DISCOVER,
    /** a partner requested access (contract layer). */
    REQUEST,
    /** a contract was negotiated (contract layer). */
    NEGOTIATE,
    /** a confidential payload was pulled (usage layer). */
    PULL,
    /** a matchmaking lifecycle step (RFQ posted, shortlist, accept, confirm, feedback). */
    MATCH,
    /** the LLM assistant was used (records redactions, never the prompt). */
    ASSIST,
    /** an owner changed an asset's terms (who may discover it, contract policy) and republished it. */
    POLICY
}
