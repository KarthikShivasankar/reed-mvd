/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.offering;

import org.example.reed.assistant.AssistantController;
import org.example.reed.assistant.PersonalDataRedactor;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.domain.Offering;
import org.example.reed.domain.Rfq;
import org.example.reed.offering.OfferingService.ConstraintForm;
import org.example.reed.offering.OfferingService.MatchResult;
import org.example.reed.offering.OfferingService.OfferingForm;
import org.example.reed.offering.OfferingService.OfferingView;
import org.example.reed.offering.OfferingService.PolicyView;
import org.example.reed.policy.opa.PolicyDecisionService;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.RfqRepository;
import org.example.reed.security.CurrentUser;
import org.example.reed.security.Members;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Capability catalogue and service RFQs. A provider's data steward registers and publishes offerings
 * and their policy; any member browses published ones; a buyer posts a service RFQ and gets, per
 * offering, the capability match and the policy eligibility apart.
 */
@RestController
public class OfferingController {

    public record PolicyForm(List<ConstraintForm> policy) {
    }

    public record ServiceRfqForm(String title, String story, String capability, List<String> keywords, Integer requiredCapacity,
                                 String preferredRegion, LocalDate startDate, LocalDate endDate, String purpose) {
    }

    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(OfferingController.class);

    private final OfferingService service;
    private final RfqRepository rfqs;
    private final AuditEventRepository audit;
    private final Members members;
    private final Clock clock;

    public OfferingController(OfferingService service, RfqRepository rfqs, AuditEventRepository audit, Members members, Clock clock) {
        this.service = service;
        this.rfqs = rfqs;
        this.audit = audit;
        this.members = members;
        this.clock = clock;
    }

    @GetMapping("/reed/offerings")
    public List<OfferingView> list(@AuthenticationPrincipal Jwt jwt) {
        var bpn = members.memberOrOperator(CurrentUser.of(jwt));
        return service.list(bpn, bpn == null);
    }

    @GetMapping("/reed/offerings/{id}")
    public OfferingView get(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        var bpn = members.memberOrOperator(CurrentUser.of(jwt));
        var o = service.get(id);
        if (!o.published && bpn != null && !o.providerBpn.equals(bpn)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown offering " + id);
        }
        return service.view(o);
    }

    @PostMapping("/reed/offerings")
    @ResponseStatus(HttpStatus.CREATED)
    public OfferingView create(@AuthenticationPrincipal Jwt jwt, @RequestBody OfferingForm f) {
        return service.view(service.create(steward(jwt), null, f));
    }

    @PutMapping("/reed/offerings/{id}/policy")
    public OfferingView policy(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody PolicyForm f) {
        return service.view(service.setPolicy(own(jwt, id), f.policy()));
    }

    @PostMapping("/reed/offerings/{id}/publish")
    public OfferingView publish(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        return service.view(service.publish(own(jwt, id), CurrentUser.of(jwt).username()));
    }

    /** The policy builder's preview: the constraints as ODRL, in words, combined, and as Rego. Stores nothing. */
    @PostMapping("/reed/policies/translate")
    public PolicyView translate(@AuthenticationPrincipal Jwt jwt, @RequestBody PolicyForm f) {
        var bpn = members.memberOrOperator(CurrentUser.of(jwt));
        return service.translate(bpn == null ? "BPN-PROVIDER" : bpn, f.policy());
    }

    @PostMapping("/reed/service-rfqs")
    @ResponseStatus(HttpStatus.CREATED)
    public Rfq createRfq(@AuthenticationPrincipal Jwt jwt, @RequestBody ServiceRfqForm f) {
        var user = CurrentUser.of(jwt);
        var bpn = members.member(user);
        if (!user.has("buyer")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "requires role buyer");
        }
        var today = LocalDate.now(clock);
        if (f.title() == null || f.title().isBlank() || f.capability() == null || f.capability().isBlank()
                || f.startDate() == null || f.endDate() == null || f.startDate().isBefore(today) || !f.endDate().isAfter(f.startDate())
                || f.purpose() == null || !PolicyDecisionService.PURPOSES.contains(f.purpose())
                || (f.requiredCapacity() != null && f.requiredCapacity() < 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "title, capability, startDate (today or later), a later endDate "
                    + "and a purpose (" + String.join(", ", PolicyDecisionService.PURPOSES) + ") are mandatory");
        }
        var r = new Rfq();
        r.id = "RFQ-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        r.buyerBpn = bpn;
        // RFQs are visible to every member: organisation and service data only
        var names = AssistantController.personNames(jwt);
        r.title = PersonalDataRedactor.redact(f.title(), names).text();
        r.story = f.story() == null ? null : PersonalDataRedactor.redact(f.story(), names).text();
        r.capability = OfferingService.slug(f.capability());
        r.keywords = f.keywords() == null ? List.of() : f.keywords().stream().map(String::strip).filter(k -> !k.isEmpty()).toList();
        r.requiredCapacity = f.requiredCapacity();
        r.preferredRegion = f.preferredRegion() == null || f.preferredRegion().isBlank() ? null : f.preferredRegion().strip();
        r.startDate = f.startDate();
        r.endDate = f.endDate();
        r.purpose = f.purpose();
        // the part-RFQ columns, so every reader of reed_rfq finds what it expects
        r.sector = "service";
        r.dimsMm = List.of();
        r.quantity = 1;
        r.dueDate = f.startDate();
        r.requiredProcesses = List.of();
        r.requiredCerts = List.of();
        r.partnerProcesses = List.of();
        rfqs.save(r);
        audit.save(new AuditEvent(EventType.MATCH, bpn, null, "service RFQ " + r.id + " posted by " + user.username() + ": " + r.title
                + " (" + r.capability + ", purpose " + r.purpose + ")"));
        try {
            service.matches(r, true);  // the first policy-aware match is part of the record
        } catch (RuntimeException e) {
            LOG.warn("service RFQ {} posted, but its first match could not be recorded: {}", r.id, e.getMessage());
        }
        return r;
    }

    /** Capability match, policy eligibility and the final answer per offering - for the buyer and the operator only. */
    @GetMapping("/reed/rfqs/{id}/service-matches")
    public List<MatchResult> matches(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        var bpn = members.memberOrOperator(CurrentUser.of(jwt));
        var rfq = rfqs.findById(id).filter(r -> r.capability != null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown service RFQ " + id));
        if (bpn != null && !rfq.buyerBpn.equals(bpn)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only the buyer sees who is eligible for its RFQ");
        }
        return service.matches(rfq, false);
    }

    /** The caller's BPN: an active member's data steward (never the operator - a company's offerings are its own). */
    private String steward(Jwt jwt) {
        var user = CurrentUser.of(jwt);
        var bpn = members.member(user);
        if (!user.has("data-steward")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "requires role data-steward");
        }
        return bpn;
    }

    /** The offering if the caller's organisation owns it; someone else's answers like a missing one. */
    private Offering own(Jwt jwt, String id) {
        var bpn = steward(jwt);
        var o = service.get(id);
        if (!o.providerBpn.equals(bpn)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown offering " + id);
        }
        return o;
    }
}
