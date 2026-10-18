/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.domain.AuditEvent;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.security.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Objects;

/**
 * Read access to the append-only REED audit log (most recent first). Members
 * see events where their organisation is the actor or owns the asset; admins
 * and quality auditors see everything.
 */
@RestController
public class AuditController {

    private final AuditEventRepository audit;

    public AuditController(AuditEventRepository audit) {
        this.audit = audit;
    }

    @GetMapping("/reed/audit")
    public List<AuditEvent> audit(@AuthenticationPrincipal Jwt jwt) {
        var user = CurrentUser.of(jwt);
        var all = audit.findTop500ByOrderByAtDesc();
        if (user.canImpersonateView()) {
            return all;
        }
        var bpn = user.bpn();
        var tag = bpn == null ? "\u0000" : bpn;
        return all.stream()
                .filter(e -> Objects.equals(e.actorBpn, bpn) || (e.detail != null && e.detail.contains(tag)))
                .toList();
    }
}
