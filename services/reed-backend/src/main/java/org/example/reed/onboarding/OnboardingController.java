/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.onboarding;

import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.domain.Participant;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.policy.opa.OpaClient;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.security.CurrentUser;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Consortium management, for the REED operator (realm role {@code admin}) only: onboard a company,
 * maintain the attributes policies are evaluated against, and set its membership status.
 *
 * <p>Onboarding registers the company and its attributes. Its connector, IdentityHub and policy
 * decision point are containers of the deployment: they are provisioned from the roster by
 * {@code tools/gen_topology.py} (a new identity needs a fresh Vault), not by this API. A company
 * without a connector can be matched and judged by policy, but cannot be contracted for data.
 */
@RestController
public class OnboardingController {

    private static final Set<String> ROLES = Set.of("OEM", "SUPPLIER", "SERVICE");
    private static final Set<String> STATUSES = Set.of("PENDING", "ACTIVE", "SUSPENDED");

    public record CompanyForm(String name, String shortName, String role, String country, String city, String industry,
                              List<String> sectors, List<String> competitorClasses, Boolean verified) {
    }

    public record StatusForm(String status) {
    }

    public record ConnectorStatus(String bpn, String company, String connector, String endpoint, String did, boolean online,
                                  String decisionPoint, boolean decisionPointOnline) {
    }

    private final ParticipantRepository participants;
    private final AuditEventRepository audit;
    private final ConnectorClient connectors;
    private final OpaClient opa;

    public OnboardingController(ParticipantRepository participants, AuditEventRepository audit, ConnectorClient connectors, OpaClient opa) {
        this.participants = participants;
        this.audit = audit;
        this.connectors = connectors;
        this.opa = opa;
    }

    /** Registers a company as PENDING: known to REED, not yet a member. */
    @PostMapping("/reed/onboarding")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Participant onboard(@AuthenticationPrincipal Jwt jwt, @RequestBody CompanyForm f) {
        var admin = admin(jwt);
        if (f.name() == null || f.name().isBlank() || f.name().length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name is mandatory");
        }
        var p = new Participant("BPN-REED-ONB-" + UUID.randomUUID().toString().substring(0, 6).toUpperCase());
        p.name = f.name().strip();
        p.membershipStatus = "PENDING";
        p.consortium = false;
        p.sectors = List.of();
        p.attestations = List.of();
        apply(p, f);
        if (p.role == null || p.country == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "role (OEM, SUPPLIER or SERVICE) and country (two letters) are mandatory");
        }
        participants.save(p);
        audit.save(new AuditEvent(EventType.ONBOARD, p.bpn, null, admin + " registered " + p.name + " (" + p.role + ", " + p.country
                + ") for onboarding: PENDING"));
        return p;
    }

    /** Changes the attributes access policies are evaluated against. */
    @PutMapping("/reed/onboarding/{bpn}")
    @Transactional
    public Participant update(@AuthenticationPrincipal Jwt jwt, @PathVariable String bpn, @RequestBody CompanyForm f) {
        var admin = admin(jwt);
        var p = company(bpn);
        if (p.connectorName != null && (f.role() != null && !f.role().equals(p.role) || f.country() != null && !f.country().equals(p.country))) {
            // role and country are in the company's verifiable credentials: changing them here would make
            // REED and the connectors disagree. They change in the roster, with a re-issued credential.
            throw new ResponseStatusException(HttpStatus.CONFLICT, "role and country of a company with a connector are part of its "
                    + "membership credential and cannot be changed here");
        }
        apply(p, f);
        participants.save(p);
        audit.save(new AuditEvent(EventType.ONBOARD, p.bpn, null, admin + " updated the attributes of " + p.name + ": industry "
                + p.industry + ", competitor classes " + p.competitorClasses + ", verified " + p.verified));
        return p;
    }

    @PostMapping("/reed/onboarding/{bpn}/status")
    @Transactional
    public Participant status(@AuthenticationPrincipal Jwt jwt, @PathVariable String bpn, @RequestBody StatusForm f) {
        var admin = admin(jwt);
        var p = company(bpn);
        if (f.status() == null || !STATUSES.contains(f.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "status must be one of " + STATUSES);
        }
        var before = p.membershipStatus;
        p.membershipStatus = f.status();
        p.consortium = f.status().equals("ACTIVE");
        participants.save(p);
        audit.save(new AuditEvent(EventType.ONBOARD, p.bpn, null, admin + " set the membership of " + p.name + " from " + before
                + " to " + p.membershipStatus));
        return p;
    }

    /** Every registered connector with its endpoint, whether it answers, and its policy decision point. */
    @GetMapping("/reed/operator/connectors")
    public List<ConnectorStatus> connectors(@AuthenticationPrincipal Jwt jwt) {
        if (!CurrentUser.of(jwt).canImpersonateView()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "operator only");
        }
        var query = "{\"@context\":[\"https://w3id.org/edc/connector/management/v2\"],\"@type\":\"QuerySpec\",\"limit\":1}";
        return participants.findAll().stream().filter(p -> p.connectorName != null).sorted(java.util.Comparator.comparing(p -> p.name))
                .parallel()
                .map(p -> new ConnectorStatus(p.bpn, p.name, p.connectorName, p.dspUrl, p.did,
                        online(p, query),
                        opa.url(p.connectorName), opa.up(p.connectorName)))
                .toList();
    }

    private boolean online(Participant p, String query) {
        try {
            return connectors.exchange(p.connectorName, p.managementUrl, HttpMethod.POST, "/v4/assets/request", query)
                    .getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            return false;
        }
    }

    private void apply(Participant p, CompanyForm f) {
        for (var s : new String[] {f.shortName(), f.city(), f.industry()}) {
            if (s != null && s.length() > 100) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "short name, city and industry are at most 100 characters");
            }
        }
        if ((f.sectors() != null && f.sectors().size() > 20) || (f.competitorClasses() != null && f.competitorClasses().size() > 20)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "at most 20 sectors and 20 competitor classes");
        }
        if (f.shortName() != null && !f.shortName().isBlank()) {
            p.shortName = f.shortName().strip();
        } else if (p.shortName == null) {
            p.shortName = p.name.split(" ")[0];
        }
        if (f.role() != null) {
            if (!ROLES.contains(f.role())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "role must be one of " + ROLES);
            }
            p.role = f.role();
        }
        if (f.country() != null) {
            if (!f.country().matches("[A-Za-z]{2}")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "country is a two-letter code");
            }
            p.country = f.country().toUpperCase(Locale.ROOT);
        }
        if (f.city() != null) {
            p.city = f.city().strip();
        }
        if (f.industry() != null) {
            p.industry = f.industry().strip();
        }
        if (f.sectors() != null) {
            p.sectors = clean(f.sectors());
        }
        if (f.competitorClasses() != null) {
            p.competitorClasses = clean(f.competitorClasses());
        }
        if (f.verified() != null) {
            p.verified = f.verified();
        }
    }

    private static List<String> clean(List<String> l) {
        return l.stream().map(s -> s.strip().toLowerCase(Locale.ROOT)).filter(s -> s.matches("[a-z0-9-]{1,48}")).distinct().toList();
    }

    private Participant company(String bpn) {
        return participants.findById(bpn).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown company " + bpn));
    }

    private static String admin(Jwt jwt) {
        var user = CurrentUser.of(jwt);
        if (!user.isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only the REED operator onboards companies");
        }
        return user.username();
    }
}
