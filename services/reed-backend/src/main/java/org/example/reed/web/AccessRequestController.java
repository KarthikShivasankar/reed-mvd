/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.domain.AccessRequest;
import org.example.reed.domain.AssetClass;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.domain.RequestState;
import org.example.reed.repo.AccessRequestRepository;
import org.example.reed.repo.AuditEventRepository;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/**
 * Records partner access requests (the bridge between catalogue discovery and
 * contract negotiation). Each new request is logged as a {@code REQUEST} audit
 * event.
 */
@RestController
@RequestMapping("/reed/access-requests")
public class AccessRequestController {

    private final AccessRequestRepository requests;
    private final AuditEventRepository audit;

    public AccessRequestController(AccessRequestRepository requests, AuditEventRepository audit) {
        this.requests = requests;
        this.audit = audit;
    }

    public record Form(String requesterBpn, String assetId, String reason) {
    }

    @GetMapping
    public List<AccessRequest> list() {
        return requests.findAll();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AccessRequest create(@RequestBody Form form) {
        var assetClass = AssetClass.fromAssetId(form.assetId());
        if (assetClass == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown asset " + form.assetId());
        }
        var saved = requests.save(new AccessRequest(form.requesterBpn(), form.assetId(),
                assetClass, RequestState.REQUESTED, form.reason()));
        audit.save(new AuditEvent(EventType.REQUEST, form.requesterBpn(), form.assetId(),
                "access requested: " + form.reason()));
        return saved;
    }
}
