/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.domain.MatchRecord;
import org.example.reed.domain.Rfq;
import org.example.reed.match.MatchService;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.MatchRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.RfqRepository;
import org.example.reed.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Matchmaking API: RFQs (demand), ranked suppliers, partner recommendations,
 * supplier opportunities and the match lifecycle. Every rule about who may
 * see or do what is enforced here from the token, not trusted from requests:
 * <ul>
 *   <li>only consortium members with the {@code buyer} role post RFQs;</li>
 *   <li>the buyer (and admins/auditors) see the full ranking incl. rejected
 *       suppliers; a supplier sees only its own row - never competitors';</li>
 *   <li>only the buyer shortlists/confirms, only the supplier accepts.</li>
 * </ul>
 */
@RestController
public class MatchController {

    public record RfqForm(String title, String story, String sector, String partFamily, String material,
                          List<Integer> dimsMm, Double massKg, Double tolMm, Integer quantity, LocalDate dueDate,
                          Double deliveryLat, Double deliveryLon, List<String> requiredProcesses,
                          List<String> requiredCerts, List<String> partnerProcesses) {
    }

    public record ConfirmForm(String agreementId) {
    }

    public record FeedbackForm(boolean onTime, boolean qualityOk) {
    }

    private final MatchService service;
    private final RfqRepository rfqs;
    private final MatchRepository matches;
    private final ParticipantRepository participants;
    private final AuditEventRepository audit;

    public MatchController(MatchService service, RfqRepository rfqs, MatchRepository matches,
                           ParticipantRepository participants, AuditEventRepository audit) {
        this.service = service;
        this.rfqs = rfqs;
        this.matches = matches;
        this.participants = participants;
        this.audit = audit;
    }

    @GetMapping("/reed/rfqs")
    public List<Rfq> list(@AuthenticationPrincipal Jwt jwt) {
        member(CurrentUser.of(jwt));
        return rfqs.findAllByOrderByCreatedAtDesc();
    }

    @GetMapping("/reed/rfqs/{id}")
    public Rfq get(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        member(CurrentUser.of(jwt));
        return rfq(id);
    }

    @PostMapping("/reed/rfqs")
    @ResponseStatus(HttpStatus.CREATED)
    public Rfq create(@AuthenticationPrincipal Jwt jwt, @RequestBody RfqForm f) {
        var user = CurrentUser.of(jwt);
        var bpn = member(user);
        user.require("buyer");
        if (f.title() == null || f.title().isBlank() || f.sector() == null || f.dimsMm() == null
                || f.dimsMm().size() != 3 || f.dimsMm().stream().anyMatch(d -> d == null || d <= 0)
                || f.massKg() == null || f.massKg() <= 0 || f.dueDate() == null
                || f.requiredProcesses() == null || f.requiredProcesses().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "title, sector, dimsMm [L,W,H] > 0, massKg > 0, dueDate and at least one required process are mandatory");
        }
        if (!f.dueDate().isAfter(LocalDate.now())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "dueDate must be in the future");
        }
        var r = new Rfq();
        r.id = "RFQ-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        r.buyerBpn = bpn;
        r.title = f.title();
        r.story = f.story();
        r.sector = f.sector();
        r.partFamily = f.partFamily();
        r.material = f.material();
        r.dimsMm = f.dimsMm();
        r.massKg = f.massKg();
        r.tolMm = f.tolMm();
        r.quantity = f.quantity() == null ? 1 : f.quantity();
        r.dueDate = f.dueDate();
        r.deliveryLat = f.deliveryLat();
        r.deliveryLon = f.deliveryLon();
        r.requiredProcesses = f.requiredProcesses();
        r.requiredCerts = f.requiredCerts() == null ? List.of() : f.requiredCerts();
        r.partnerProcesses = f.partnerProcesses() == null ? List.of() : f.partnerProcesses();
        audit.save(new AuditEvent(EventType.MATCH, bpn, null, "RFQ " + r.id + " posted by " + user.username() + ": " + r.title));
        return rfqs.save(r);
    }

    @GetMapping("/reed/rfqs/{id}/matches")
    public List<MatchService.RankedSupplier> matches(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        var user = CurrentUser.of(jwt);
        var bpn = member(user);
        var rfq = rfq(id);
        var ranked = service.rank(rfq);
        if (rfq.buyerBpn.equals(bpn) || user.canImpersonateView()) {
            return ranked;
        }
        return ranked.stream().filter(r -> r.result().bpn().equals(bpn)).toList();
    }

    @GetMapping("/reed/rfqs/{id}/partners")
    public List<MatchService.Partner> partners(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        var user = CurrentUser.of(jwt);
        var bpn = member(user);
        var rfq = rfq(id);
        if (!rfq.buyerBpn.equals(bpn) && !user.canImpersonateView()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only the buyer sees partner recommendations");
        }
        return service.partners(rfq, rfq.buyerBpn);
    }

    @GetMapping("/reed/opportunities")
    public List<MatchService.Opportunity> opportunities(@AuthenticationPrincipal Jwt jwt) {
        return service.opportunities(member(CurrentUser.of(jwt)));
    }

    @GetMapping("/reed/matches")
    public List<MatchRecord> myMatches(@AuthenticationPrincipal Jwt jwt) {
        var bpn = member(CurrentUser.of(jwt));
        return matches.findByBuyerBpnOrSupplierBpnOrderByUpdatedAtDesc(bpn, bpn).stream()
                .filter(m -> !m.rfqId.startsWith("HIST-")).toList();
    }

    @PostMapping("/reed/rfqs/{id}/shortlist/{supplierBpn}")
    public MatchRecord shortlist(@AuthenticationPrincipal Jwt jwt, @PathVariable String id,
                                 @PathVariable String supplierBpn) {
        var user = CurrentUser.of(jwt);
        var rfq = rfq(id);
        requireBuyer(user, rfq.buyerBpn);
        if (rfq.state != Rfq.State.OPEN) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "RFQ " + id + " is " + rfq.state);
        }
        return service.shortlist(rfq, supplierBpn);
    }

    @PostMapping("/reed/matches/{id}/accept")
    public MatchRecord accept(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        var m = match(id);
        requireSupplier(CurrentUser.of(jwt), m);
        return service.respond(m, true);
    }

    @PostMapping("/reed/matches/{id}/decline")
    public MatchRecord decline(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        var m = match(id);
        requireSupplier(CurrentUser.of(jwt), m);
        return service.respond(m, false);
    }

    @PostMapping("/reed/matches/{id}/confirm")
    public MatchRecord confirm(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody ConfirmForm f) {
        var m = match(id);
        requireBuyer(CurrentUser.of(jwt), m.buyerBpn);
        if (f.agreementId() == null || f.agreementId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "agreementId is required");
        }
        return service.confirm(m, f.agreementId());
    }

    @PostMapping("/reed/matches/{id}/feedback")
    public MatchRecord feedback(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody FeedbackForm f) {
        var user = CurrentUser.of(jwt);
        var m = match(id);
        if (!(m.buyerBpn.equals(user.bpn()) && (user.has("buyer") || user.has("quality-auditor"))) && !user.isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only the buyer's buyers or quality auditors give feedback");
        }
        return service.feedback(m, f.onTime(), f.qualityOk());
    }

    // ---------------------------------------------------------------- guards

    private String member(CurrentUser user) {
        if (user.isAdmin() && user.bpn() == null) {
            return "BPN-REED-ADMIN";
        }
        var bpn = user.requireBpn();
        if (!participants.existsByBpnAndConsortiumTrue(bpn)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, bpn + " is not a REED consortium member");
        }
        return bpn;
    }

    private void requireBuyer(CurrentUser user, String buyerBpn) {
        if (user.isAdmin()) {
            return;
        }
        member(user);
        if (!buyerBpn.equals(user.bpn()) || !user.has("buyer")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only a buyer of " + buyerBpn + " may do this");
        }
    }

    private void requireSupplier(CurrentUser user, MatchRecord m) {
        if (user.isAdmin()) {
            return;
        }
        member(user);
        if (!m.supplierBpn.equals(user.bpn()) || !user.has("supplier-engineer")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only a supplier engineer of " + m.supplierBpn + " may do this");
        }
    }

    private Rfq rfq(String id) {
        return rfqs.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown RFQ " + id));
    }

    private MatchRecord match(long id) {
        return matches.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown match " + id));
    }
}
