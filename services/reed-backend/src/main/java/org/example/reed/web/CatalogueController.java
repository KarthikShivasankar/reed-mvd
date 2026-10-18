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
import org.example.reed.security.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REED catalogue layer: returns the asset metadata the caller's organisation is
 * allowed to discover (never the payload). The organisation comes from the
 * access token; only admins and quality auditors may ask "what would BPN X
 * see?" via {@code ?bpn=}. Each query is recorded as a {@code DISCOVER} event.
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
    public List<AssetMetadata> catalogue(@AuthenticationPrincipal Jwt jwt,
                                         @RequestParam(required = false) String bpn) {
        var user = CurrentUser.of(jwt);
        var subject = bpn != null && !bpn.isBlank() && user.canImpersonateView() ? bpn : user.bpn();
        var visible = catalogue.visibleTo(subject);
        audit.save(new AuditEvent(EventType.DISCOVER, subject, null,
                "catalogue query by " + user.username() + " returned " + visible.size() + " asset(s)"));
        return visible;
    }
}
