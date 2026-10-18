/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.domain.AccessRequest;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.domain.RequestState;
import org.example.reed.repo.AccessRequestRepository;
import org.example.reed.repo.AssetRepository;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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
 * contract negotiation). The requester is the caller's organisation from the
 * token - never a field in the request body.
 */
@RestController
@RequestMapping("/reed/access-requests")
public class AccessRequestController {

    private final AccessRequestRepository requests;
    private final AssetRepository assets;
    private final AuditEventRepository audit;

    public AccessRequestController(AccessRequestRepository requests, AssetRepository assets,
                                   AuditEventRepository audit) {
        this.requests = requests;
        this.assets = assets;
        this.audit = audit;
    }

    public record Form(String assetId, String reason) {
    }

    @GetMapping
    public List<AccessRequest> list(@AuthenticationPrincipal Jwt jwt) {
        var user = CurrentUser.of(jwt);
        var all = requests.findAll();
        return user.canImpersonateView() ? all
                : all.stream().filter(r -> r.requesterBpn.equals(user.bpn())).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AccessRequest create(@AuthenticationPrincipal Jwt jwt, @RequestBody Form form) {
        var bpn = CurrentUser.of(jwt).requireBpn();
        var asset = assets.findById(form.assetId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown asset " + form.assetId()));
        var saved = requests.save(new AccessRequest(bpn, asset.assetId, asset.assetClass,
                RequestState.REQUESTED, form.reason()));
        audit.save(new AuditEvent(EventType.REQUEST, bpn, asset.assetId, "access requested: " + form.reason()));
        return saved;
    }
}
