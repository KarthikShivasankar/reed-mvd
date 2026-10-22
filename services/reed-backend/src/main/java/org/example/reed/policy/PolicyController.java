/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.policy;

import org.example.reed.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/**
 * Who gets an owner's data and why. The owner is the caller's organisation (from the token); the dataspace
 * operator may look at any owner and the full matrix, but changing terms is the owner's alone.
 */
@RestController
public class PolicyController {

    private final PolicyService policies;

    public PolicyController(PolicyService policies) {
        this.policies = policies;
    }

    @GetMapping("/reed/policy/access")
    public List<PolicyService.AssetAccess> access(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String owner) {
        var user = CurrentUser.of(jwt);
        return policies.access(owner != null && !owner.isBlank() && user.canImpersonateView() ? owner : user.requireBpn());
    }

    /** What the caller's organisation can discover from the others, and would get under their current terms. */
    @GetMapping("/reed/policy/inbound")
    public PolicyService.Inbound inbound(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String bpn) {
        var user = CurrentUser.of(jwt);
        return policies.inbound(bpn != null && !bpn.isBlank() && user.canImpersonateView() ? bpn : user.requireBpn());
    }

    /** What-if: the asset under other terms, nothing published. */
    @GetMapping("/reed/policy/preview")
    public PolicyService.AssetAccess preview(@AuthenticationPrincipal Jwt jwt, @RequestParam String assetId,
                                             @RequestParam String discoverability, @RequestParam String policyTemplate) {
        var user = CurrentUser.of(jwt);
        return policies.preview(user.canImpersonateView() ? null : user.requireBpn(), assetId, discoverability, policyTemplate);
    }

    @GetMapping("/reed/policy/matrix")
    public List<PolicyService.AssetAccess> matrix(@AuthenticationPrincipal Jwt jwt) {
        if (!CurrentUser.of(jwt).canImpersonateView()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "the full matrix is for the dataspace operator");
        }
        return policies.matrix();
    }

    @PutMapping("/reed/assets/{assetId}/policy")
    public PolicyService.AssetAccess change(@AuthenticationPrincipal Jwt jwt, @PathVariable String assetId,
                                            @RequestBody PolicyService.Change change) {
        var user = CurrentUser.of(jwt);
        if (user.bpn() == null || user.bpn().isBlank()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only the owner sets the terms of its data - the operator cannot");
        }
        if (!user.has("data-steward")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only your organisation's data steward sets the terms of its data");
        }
        return policies.change(user.bpn(), user.username(), assetId, change);
    }
}
