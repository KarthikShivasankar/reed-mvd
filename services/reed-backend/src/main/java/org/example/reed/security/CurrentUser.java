/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.security;

import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * The authenticated caller, taken from the Keycloak access token. The
 * organisation ({@code bpn}, {@code participant} = connector name) comes from
 * user attributes mapped into the token, so a caller can never act for an
 * organisation other than its own by changing a request parameter.
 */
public record CurrentUser(String username, String bpn, String participant, List<String> roles) {

    public static CurrentUser of(Jwt jwt) {
        List<String> roles = List.of();
        if (jwt.getClaim("realm_access") instanceof Map<?, ?> realm && realm.get("roles") instanceof List<?> r) {
            roles = r.stream().map(String::valueOf).toList();
        }
        return new CurrentUser(jwt.getClaimAsString("preferred_username"), jwt.getClaimAsString("bpn"),
                jwt.getClaimAsString("participant"), roles);
    }

    public boolean has(String role) {
        return roles.contains(role);
    }

    public boolean isAdmin() {
        return has("admin");
    }

    /** Admins and quality auditors may look at the dataspace from another member's point of view. */
    public boolean canImpersonateView() {
        return has("admin") || has("quality-auditor");
    }

    public String requireBpn() {
        if (bpn == null || bpn.isBlank()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "user is not linked to an organisation (no bpn claim)");
        }
        return bpn;
    }

    public void require(String role) {
        if (!has(role) && !isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "requires role " + role);
        }
    }
}
