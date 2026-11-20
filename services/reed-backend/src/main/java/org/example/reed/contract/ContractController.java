/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.contract;

import org.example.reed.contract.ContractService.ContractView;
import org.example.reed.domain.Contract;
import org.example.reed.domain.PolicyDecision;
import org.example.reed.offering.OfferingService;
import org.example.reed.policy.opa.PolicyDecisionService;
import org.example.reed.policy.opa.PolicyDecisionService.Outcome;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyDecisionRepository;
import org.example.reed.repo.RfqRepository;
import org.example.reed.security.CurrentUser;
import org.example.reed.security.Members;
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

import java.time.Clock;
import java.time.Instant;
import java.util.List;

/**
 * Contracts and the policy decision log. A contract is visible to its two parties and the operator;
 * to anyone else it does not exist (404). Only the buyer moves it forward; either party or the operator
 * may terminate it.
 */
@RestController
public class ContractController {

    public record SelectForm(String rfqId, String offeringId) {
    }

    public record AgreedForm(String agreementId) {
    }

    /** {@code contractId}: the contract's policy at the provider's OPA; else {@code offeringId} + {@code requesterBpn}: eligibility. */
    public record SimulateForm(String contractId, String offeringId, String requesterBpn, String purpose, Instant at) {
    }

    /** A logged decision with the names the dashboard shows. */
    public record DecisionRow(Outcome outcome, String requesterBpn, String requester, String providerBpn, String provider,
                              String contractId, String offeringId, String rfqId, String assetId, String action, String purpose) {
    }

    private final ContractService service;
    private final OfferingService offerings;
    private final PolicyDecisionService decisions;
    private final PolicyDecisionRepository decisionLog;
    private final RfqRepository rfqs;
    private final ParticipantRepository participants;
    private final Members members;
    private final Clock clock;

    public ContractController(ContractService service, OfferingService offerings, PolicyDecisionService decisions,
                              PolicyDecisionRepository decisionLog, RfqRepository rfqs, ParticipantRepository participants,
                              Members members, Clock clock) {
        this.service = service;
        this.offerings = offerings;
        this.decisions = decisions;
        this.decisionLog = decisionLog;
        this.rfqs = rfqs;
        this.participants = participants;
        this.members = members;
        this.clock = clock;
    }

    @PostMapping("/reed/contracts")
    @ResponseStatus(HttpStatus.CREATED)
    public ContractView select(@AuthenticationPrincipal Jwt jwt, @RequestBody SelectForm f) {
        var bpn = buyer(jwt);
        var rfq = rfqs.findById(f.rfqId() == null ? "" : f.rfqId()).filter(r -> r.buyerBpn.equals(bpn))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "you have no RFQ " + f.rfqId()));
        var o = offerings.get(f.offeringId() == null ? "" : f.offeringId());
        if (!o.published) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown offering " + f.offeringId());
        }
        return service.view(service.select(rfq, o));
    }

    @GetMapping("/reed/contracts")
    public List<ContractView> list(@AuthenticationPrincipal Jwt jwt) {
        return service.list(members.memberOrOperator(CurrentUser.of(jwt)));
    }

    @GetMapping("/reed/contracts/{id}")
    public ContractView get(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        return service.view(visible(jwt, id));
    }

    @PostMapping("/reed/contracts/{id}/accept")
    public ContractView accept(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        return service.view(service.accept(asBuyer(jwt, id)));
    }

    @PostMapping("/reed/contracts/{id}/agreed")
    public ContractView agreed(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody AgreedForm f) {
        return service.view(service.agreed(asBuyer(jwt, id), f.agreementId()));
    }

    /** Retry of AGREED -> ACTIVE when the provider's decision point was not reachable. */
    @PostMapping("/reed/contracts/{id}/activate")
    public ContractView activate(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        var c = visible(jwt, id);
        acting(CurrentUser.of(jwt));
        return service.view(service.activate(c));
    }

    @PostMapping("/reed/contracts/{id}/terminate")
    public ContractView terminate(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
        var user = CurrentUser.of(jwt);
        var c = visible(jwt, id);
        acting(user);
        return service.view(service.terminate(c, user.isAdmin() ? "the REED operator" : user.bpn()));
    }

    @GetMapping("/reed/policy-decisions")
    public List<DecisionRow> decisions(@AuthenticationPrincipal Jwt jwt) {
        var bpn = members.memberOrOperator(CurrentUser.of(jwt));
        // Matchmaking-time rows belong to the buyer alone ("only the buyer sees who is eligible for its RFQ"):
        // a provider sees the requests that reached its connector and the simulations about its policies.
        var rows = bpn == null ? decisionLog.findTop300ByOrderByAtDesc()
                : decisionLog.visibleTo(bpn, org.springframework.data.domain.PageRequest.of(0, 300));
        var names = decisions.names();
        return rows.stream().map(d -> row(d, names)).toList();
    }

    /** A what-if request sent to Open Policy Agent; logged as SIMULATED. */
    @PostMapping("/reed/policy-decisions/simulate")
    public Outcome simulate(@AuthenticationPrincipal Jwt jwt, @RequestBody SimulateForm f) {
        var bpn = members.memberOrOperator(CurrentUser.of(jwt));
        var at = f.at() == null ? clock.instant() : f.at();
        var purpose = f.purpose() == null ? "" : f.purpose();
        if (!purpose.matches("[a-z0-9-]{0,64}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "malformed purpose");
        }
        if (f.contractId() != null) {
            return service.simulate(visible(jwt, f.contractId()), purpose, at);
        }
        var o = offerings.get(f.offeringId() == null ? "" : f.offeringId());
        // a member may ask only about itself; the operator about any registered company
        var requester = participants.findById(bpn != null ? bpn : f.requesterBpn() == null ? "" : f.requesterBpn())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown company " + f.requesterBpn()));
        if (!o.published && !(bpn == null || o.providerBpn.equals(bpn))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown offering " + f.offeringId());
        }
        return decisions.eligibility(o, requester, null, purpose, at, PolicyDecision.Stage.SIMULATED, true);
    }

    private DecisionRow row(PolicyDecision d, java.util.function.Function<String, String> names) {
        return new DecisionRow(decisions.view(d), d.requesterBpn, d.requesterBpn == null ? null : names.apply(d.requesterBpn),
                d.providerBpn, d.providerBpn == null ? null : names.apply(d.providerBpn), d.contractId, d.offeringId, d.rfqId,
                d.assetId, d.action, d.purpose);
    }

    /** Seeing a contract is not acting on it: that takes the buyer, the data steward or the REED operator (admin). */
    private static void acting(CurrentUser user) {
        if (!user.isAdmin() && !user.has("buyer") && !user.has("data-steward")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "requires role buyer or data-steward");
        }
    }

    private String buyer(Jwt jwt) {
        var user = CurrentUser.of(jwt);
        var bpn = members.member(user);
        if (!user.has("buyer")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "requires role buyer");
        }
        return bpn;
    }

    /** The contract if the caller is one of its parties or the operator, else 404. */
    private Contract visible(Jwt jwt, String id) {
        var bpn = members.memberOrOperator(CurrentUser.of(jwt));
        var c = service.get(id);
        if (bpn != null && !c.consumerBpn.equals(bpn) && !c.providerBpn.equals(bpn)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown contract " + id);
        }
        return c;
    }

    private Contract asBuyer(Jwt jwt, String id) {
        var bpn = buyer(jwt);
        var c = service.get(id);
        if (!c.consumerBpn.equals(bpn)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown contract " + id);
        }
        return c;
    }
}
