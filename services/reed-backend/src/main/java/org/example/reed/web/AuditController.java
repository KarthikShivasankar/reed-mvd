/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.domain.AuditEvent;
import org.example.reed.repo.AuditEventRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Read access to the append-only REED audit log (most recent first). */
@RestController
public class AuditController {

    private final AuditEventRepository audit;

    public AuditController(AuditEventRepository audit) {
        this.audit = audit;
    }

    @GetMapping("/reed/audit")
    public List<AuditEvent> audit() {
        return audit.findAllByOrderByAtDesc();
    }
}
