/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.domain.CapabilityClaim;
import org.example.reed.domain.Participant;
import org.example.reed.participant.CredentialVerifier;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.security.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * The member directory and the caller's own identity. Directory entries carry
 * only organisation data (no people), the public capability claim and the
 * verified certifications.
 */
@RestController
public class ParticipantController {

    public record Entry(String bpn, String name, String shortName, String role, boolean consortium,
                        boolean illustrative, String country,
                        String city, String vatId, double lat, double lon, boolean portAccess, boolean railAccess,
                        List<String> sectors, String connectorName, String did, String dspUrl,
                        Set<String> verifiedCerts, CapabilityClaim capability) {
    }

    public record Me(String username, List<String> roles, Entry organisation) {
    }

    private final ParticipantRepository participants;
    private final CredentialVerifier credentials;

    public ParticipantController(ParticipantRepository participants, CredentialVerifier credentials) {
        this.participants = participants;
        this.credentials = credentials;
    }

    @GetMapping("/reed/participants")
    public List<Entry> participants() {
        return participants.findAll().stream()
                // members with a connector first, then the directory by name, non-members last
                .sorted(Comparator.comparing((Participant p) -> !p.consortium)
                        .thenComparing(p -> p.connectorName == null)
                        .thenComparing(p -> p.name))
                .map(this::entry).toList();
    }

    @GetMapping("/reed/me")
    public Me me(@AuthenticationPrincipal Jwt jwt) {
        var user = CurrentUser.of(jwt);
        var org = user.bpn() == null ? null : participants.findById(user.bpn()).map(this::entry).orElse(null);
        return new Me(user.username(), user.roles(), org);
    }

    private Entry entry(Participant p) {
        return new Entry(p.bpn, p.name, p.shortName, p.role, p.consortium, p.illustrative, p.country, p.city, p.vatId, p.lat, p.lon,
                p.portAccess, p.railAccess, p.sectors, p.connectorName, p.did, p.dspUrl,
                credentials.verifiedCerts(p), p.capability);
    }
}
