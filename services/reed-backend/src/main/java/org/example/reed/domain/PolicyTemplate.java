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

/**
 * Table {@code reed_policy_template}: a named, reusable ODRL policy template.
 *
 * <p>{@link #odrl} is a portable ODRL fragment (permissions / prohibitions /
 * obligations) with placeholders such as {@code $REQUESTER_BPN},
 * {@code $OWNER_BPN}, {@code $ASSET_ID} and {@code $EXPIRY} that
 * {@code PolicyTemplateRenderer} substitutes per request. It expresses the
 * faithful, production-intent policy across all three REED layers.
 */
@Entity
@Table(name = "reed_policy_template")
public class PolicyTemplate {

    @Id
    public String name;

    @Column(length = 512)
    public String description;

    /** Faithful ODRL fragment (JSON) with substitution placeholders. */
    @Column(length = 4000)
    public String odrl;

    protected PolicyTemplate() {
    }

    public PolicyTemplate(String name, String description, String odrl) {
        this.name = name;
        this.description = description;
        this.odrl = odrl;
    }
}
