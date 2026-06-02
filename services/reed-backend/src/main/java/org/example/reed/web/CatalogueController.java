/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.catalogue.AssetMetadata;
import org.example.reed.catalogue.CatalogueService;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.repo.AuditEventRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REED catalogue layer: returns the asset metadata a partner BPN is allowed to
 * discover (never the payload). Each query is recorded as a {@code DISCOVER}
 * audit event.
 */
@RestController
public class CatalogueController {

    private final CatalogueService catalogue;
    private final AuditEventRepository audit;

    public CatalogueController(CatalogueService catalogue, AuditEventRepository audit) {
        this.catalogue = catalogue;
        this.audit = audit;
    }

    @GetMapping("/reed/catalogue")
    public List<AssetMetadata> catalogue(@RequestParam String bpn) {
        var visible = catalogue.visibleTo(bpn);
        audit.save(new AuditEvent(EventType.DISCOVER, bpn, null,
                "catalogue query returned " + visible.size() + " asset(s)"));
        return visible;
    }
}
