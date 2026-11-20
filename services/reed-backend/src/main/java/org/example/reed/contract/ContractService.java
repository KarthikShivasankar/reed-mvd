/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.Contract;
import org.example.reed.domain.Contract.Status;
import org.example.reed.domain.EventType;
import org.example.reed.domain.Offering;
import org.example.reed.domain.Participant;
import org.example.reed.domain.PolicyDecision;
import org.example.reed.domain.Rfq;
import org.example.reed.edc.ConnectorClient;
import org.example.reed.match.MatchService;
import org.example.reed.offering.OfferingService;
import org.example.reed.offering.OfferingService.PolicyView;
import org.example.reed.policy.odrl.ConstraintKind;
import org.example.reed.policy.odrl.OdrlParser;
import org.example.reed.policy.odrl.PolicyNode;
import org.example.reed.policy.odrl.PolicyNode.Atom;
import org.example.reed.policy.odrl.RegoMapper;
import org.example.reed.policy.opa.OpaClient;
import org.example.reed.policy.opa.PolicyDecisionService;
import org.example.reed.policy.opa.PolicyDecisionService.Outcome;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.ContractRepository;
import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.PolicyDecisionRepository;
import org.example.reed.repo.RfqRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Contract formation and lifecycle. A contract is created from an RFQ's eligible match, freezes the
 * effective policy (offering policy AND this buyer AND this period AND this purpose) as ODRL and Rego,
 * and becomes ACTIVE only when the two connectors have an EDC agreement and the Rego is deployed to
 * the provider's own policy decision point.
 */
@Service
public class ContractService {

    private static final Pattern AGREEMENT_ID = Pattern.compile("[A-Za-z0-9:_.-]{1,128}");

    /** One step of the policy's way from definition to enforcement; {@code at} null: not reached yet. */
    public record Step(String key, String label, String detail, Instant at) {
    }

    public record ContractView(String id, String status, String rfqId, String offeringId, String offering, String capability,
                               String resource, String assetId, String providerBpn, String provider, String providerConnector,
                               String consumerBpn, String consumer, String consumerConnector, LocalDate startDate,
                               LocalDate expiryDate, String purpose, String agreementId, String deployedTo, Instant createdAt,
                               Instant updatedAt, PolicyView policy, List<Step> lifecycle, List<Outcome> decisions) {
    }

    private final ContractRepository contracts;
    private final RfqRepository rfqs;
    private final ParticipantRepository participants;
    private final PolicyDecisionRepository decisionLog;
    private final AuditEventRepository audit;
    private final OfferingService offerings;
    private final PolicyDecisionService decisions;
    private final OpaClient opa;
    private final ConnectorClient connectors;
    private final ObjectMapper mapper;
    private final Clock clock;

    public ContractService(ContractRepository contracts, RfqRepository rfqs, ParticipantRepository participants,
                           PolicyDecisionRepository decisionLog, AuditEventRepository audit, OfferingService offerings,
                           PolicyDecisionService decisions, OpaClient opa, ConnectorClient connectors, ObjectMapper mapper,
                           Clock clock) {
        this.contracts = contracts;
        this.rfqs = rfqs;
        this.participants = participants;
        this.decisionLog = decisionLog;
        this.audit = audit;
        this.offerings = offerings;
        this.decisions = decisions;
        this.opa = opa;
        this.connectors = connectors;
        this.mapper = mapper;
        this.clock = clock;
    }

    public Contract get(String id) {
        return contracts.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown contract " + id));
    }

    /** {@code bpn} null: every contract (the operator). */
    public List<ContractView> list(String bpn) {
        var all = bpn == null ? contracts.findAllByOrderByCreatedAtDesc()
                : contracts.findByConsumerBpnOrProviderBpnOrderByCreatedAtDesc(bpn, bpn);
        return all.stream().map(this::view).toList();
    }

    /** ACTIVE only inside its period: the stored status does not need a clock job to expire. */
    public Status status(Contract c) {
        return c.status == Status.ACTIVE && LocalDate.now(clock).isAfter(c.expiryDate) ? Status.EXPIRED : c.status;
    }

    // ---------------------------------------------------------------- formation

    /**
     * The buyer selects a provider for its RFQ: DRAFT. Eligibility is asked again here (and logged) - a
     * ranking seen earlier is not a permission.
     */
    @Transactional
    public Contract select(Rfq rfq, Offering o) {
        if (rfq.capability == null || rfq.startDate == null || rfq.endDate == null || rfq.purpose == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, rfq.id + " is not a service RFQ");
        }
        var buyer = participant(rfq.buyerBpn);
        var provider = participant(o.providerBpn);
        var match = offerings.matches(rfq, false).stream().filter(m -> m.offering().id().equals(o.id)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, o.id + " is not offered to this RFQ"));
        if (!match.capabilityMatch()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, o.name + " does not match the requested capability");
        }
        var eligibility = decisions.eligibility(o, buyer, rfq.id, rfq.purpose,
                rfq.startDate.atStartOfDay(ZoneOffset.UTC).toInstant(), PolicyDecision.Stage.MATCH, true);
        if (!eligibility.allowed()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "not eligible for " + o.name + ": " + eligibility.explanation());
        }
        if (o.assetId == null || buyer.connectorName == null || provider.connectorName == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "a contract needs a resource and a connector on both sides: the exchange runs connector to connector");
        }
        var existing = contracts.findFirstByRfqIdAndOfferingIdOrderByCreatedAtDesc(rfq.id, o.id).orElse(null);
        if (existing != null && status(existing) != Status.TERMINATED && status(existing) != Status.EXPIRED) {
            return existing;
        }

        var c = new Contract();
        c.id = "C-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        c.rfqId = rfq.id;
        c.offeringId = o.id;
        c.providerBpn = o.providerBpn;
        c.consumerBpn = rfq.buyerBpn;
        c.assetId = o.assetId;
        c.startDate = rfq.startDate;
        c.expiryDate = rfq.endDate;
        c.purpose = rfq.purpose;
        c.policyId = c.id;
        c.createdAt = c.updatedAt = clock.instant();

        // The effective policy: what the provider asks of anyone AND what was agreed with this buyer.
        var effective = PolicyNode.and(decisions.offeringPolicy(o), List.of(
                new Atom(ConstraintKind.CONSUMER, "eq", List.of(c.consumerBpn)),
                new Atom(ConstraintKind.TIME, "gteq", List.of(c.startDate.atStartOfDay(ZoneOffset.UTC).toInstant().toString())),
                new Atom(ConstraintKind.TIME, "lteq", List.of(c.expiryDate.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toString())),
                new Atom(ConstraintKind.PURPOSE, "eq", List.of(c.purpose))));
        c.odrl = OdrlParser.document("Agreement", c.id, c.providerBpn, c.consumerBpn, c.assetId, effective).toPrettyString();
        c.rego = RegoMapper.toRego(c.policyId, effective, c.id, decisions.names());
        contracts.save(c);
        log(c, "contract " + c.id + " drafted: " + buyer.name + " selected " + o.name + " of " + provider.name
                + " (" + c.startDate + " to " + c.expiryDate + ", purpose " + c.purpose + ")");
        return c;
    }

    /** The buyer accepts the shown terms; the connectors may now negotiate. */
    @Transactional
    public Contract accept(Contract c) {
        expect(c, Status.DRAFT);
        c.status = Status.NEGOTIATING;
        c.acceptedAt = clock.instant();
        log(c, "terms of " + c.id + " accepted by the buyer; EDC negotiation may start");
        return save(c);
    }

    /**
     * The buyer's connector holds an EDC agreement: verified on that connector (right asset, right two
     * parties), then the contract's Rego is deployed to the provider's policy decision point - only then
     * is the contract ACTIVE.
     */
    // Not @Transactional: it talks to a connector and an OPA; each state is saved as it is reached.
    public Contract agreed(Contract c, String agreementId) {
        expect(c, Status.NEGOTIATING);
        if (agreementId == null || !AGREEMENT_ID.matcher(agreementId).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "malformed agreement id");
        }
        var buyer = participant(c.consumerBpn);
        var provider = participant(c.providerBpn);
        JsonNode agreement;
        try {
            agreement = mapper.readTree(connectors.get(buyer.connectorName, buyer.managementUrl, "/v4/contractagreements/" + agreementId));
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "agreement " + agreementId + " could not be read");
        }
        if (!c.assetId.equals(MatchService.text(agreement, "assetId"))
                || !Objects.equals(MatchService.text(agreement, "providerId"), provider.did)
                || !Objects.equals(MatchService.text(agreement, "consumerId"), buyer.did)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "agreement " + agreementId + " is not between this buyer and provider for "
                    + c.assetId);
        }
        c.agreementId = agreementId;
        c.status = Status.AGREED;
        c.agreedAt = clock.instant();
        save(c);
        log(c, "contract " + c.id + " agreed: EDC agreement " + agreementId + " verified on " + buyer.connectorName);
        return activate(c);
    }

    /** AGREED -> ACTIVE: the policy is where it will be enforced. Safe to call again (e.g. the OPA was down). */
    public Contract activate(Contract c) {
        expect(c, Status.AGREED);
        var provider = participant(c.providerBpn);
        opa.deploy(provider.connectorName, c.policyId, c.rego);
        c.deployedTo = opa.url(provider.connectorName);
        c.deployedAt = clock.instant();
        c.status = Status.ACTIVE;
        save(c);
        log(c, "policy of " + c.id + " translated to Rego and deployed to " + c.deployedTo + "; contract ACTIVE");
        return c;
    }

    @Transactional
    public Contract terminate(Contract c, String by) {
        if (c.status == Status.TERMINATED) {
            return c;
        }
        c.status = Status.TERMINATED;
        log(c, "contract " + c.id + " terminated by " + by);
        return save(c);
    }

    // ---------------------------------------------------------------- runtime

    /** The contract a runtime request of {@code consumerBpn} for {@code assetId} is judged against, or null. */
    public Contract covering(String assetId, String consumerBpn, String purpose, Instant now) {
        // A buyer may hold several contracts for one asset. The one that covers this request is active, inside
        // its period and for the declared purpose; a newer draft, terminated, future or other-purpose contract
        // must not shadow it. Failing that the best remaining candidate, so the denial names a real contract.
        var active = contracts.findByAssetIdAndConsumerBpnAndStatusOrderByCreatedAtDesc(assetId, consumerBpn, Status.ACTIVE);
        var day = now.atZone(ZoneOffset.UTC).toLocalDate();
        var inPeriod = active.stream().filter(c -> !day.isBefore(c.startDate) && !day.isAfter(c.expiryDate)).toList();
        return inPeriod.stream().filter(c -> c.purpose.equals(purpose)).findFirst()
                .or(() -> inPeriod.stream().findFirst())
                .or(() -> active.stream().findFirst())
                .or(() -> contracts.findFirstByAssetIdAndConsumerBpnAndStatusInOrderByCreatedAtDesc(assetId, consumerBpn,
                        List.of(Status.AGREED, Status.EXPIRED, Status.TERMINATED))).orElse(null);
    }

    /** What-if at the provider's own decision point: the contract's policy with another purpose or time. */
    public Outcome simulate(Contract c, String purpose, Instant at) {
        var provider = participant(c.providerBpn);
        var o = offerings.get(c.offeringId);
        decisions.ensure(provider.connectorName, c.policyId, c.rego);
        var input = decisions.input(participant(c.consumerBpn), provider, o, c, status(c, at).name(), c.purpose, purpose, "use", at);
        var result = opa.evaluate(provider.connectorName, c.policyId, "decision", input);
        return decisions.outcome(PolicyDecision.Stage.SIMULATED, new PolicyDecisionService.Subject(c.consumerBpn, c.providerBpn,
                c.id, c.offeringId, c.rfqId, c.assetId, "use", purpose), result, opa.url(provider.connectorName), true);
    }

    public Status status(Contract c, Instant at) {
        return c.status == Status.ACTIVE && at.atZone(ZoneOffset.UTC).toLocalDate().isAfter(c.expiryDate) ? Status.EXPIRED : c.status;
    }

    // ---------------------------------------------------------------- views

    public ContractView view(Contract c) {
        var o = offerings.get(c.offeringId);
        var provider = participant(c.providerBpn);
        var consumer = participant(c.consumerBpn);
        JsonNode odrl;
        try {
            odrl = mapper.readTree(c.odrl);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        var log = decisionLog.findByContractIdOrderByAtDesc(c.id);
        var rfq = c.rfqId == null ? null : rfqs.findById(c.rfqId).orElse(null);
        var runtime = log.stream().filter(d -> d.stage.equals("RUNTIME")).findFirst().orElse(null);
        var allowed = log.stream().filter(d -> d.stage.equals("RUNTIME") && d.decision.equals("ALLOW")).findFirst().orElse(null);

        var steps = new ArrayList<Step>();
        steps.add(new Step("defined", "Policy defined", provider.name + " defined the access policy", o.createdAt));
        steps.add(new Step("attached", "Attached to capability", o.policyTemplate + " on " + o.name, o.createdAt));
        steps.add(new Step("published", "Capability published", o.resource == null ? o.name : o.resource, o.publishedAt));
        steps.add(new Step("rfq", "RFQ submitted", rfq == null ? "" : rfq.title, rfq == null ? null : rfq.createdAt));
        steps.add(new Step("matched", "Policy-aware match", consumer.name + " is eligible", c.createdAt));
        steps.add(new Step("selected", "Provider selected", "contract " + c.id + " drafted", c.createdAt));
        steps.add(new Step("contract", "Contract agreed", c.agreementId == null ? "" : "EDC agreement " + c.agreementId, c.agreedAt));
        steps.add(new Step("effective", "Effective policy fixed", "offering policy AND buyer AND period AND purpose", c.createdAt));
        steps.add(new Step("rego", "ODRL translated to Rego", "package reed.policy." + RegoMapper.name(c.policyId), c.createdAt));
        steps.add(new Step("deployed", "Deployed to connector", c.deployedTo == null ? "" : c.deployedTo, c.deployedAt));
        steps.add(new Step("runtime", "Runtime decision", runtime == null ? "" : runtime.decision + " by " + runtime.decidedBy,
                runtime == null ? null : runtime.at));
        steps.add(new Step("exchange", "Data exchanged", allowed == null ? "" : "payload released to " + consumer.name,
                allowed == null ? null : allowed.at));

        return new ContractView(c.id, status(c).name(), c.rfqId, o.id, o.name, o.capability, o.resource, c.assetId, c.providerBpn,
                provider.name, provider.connectorName, c.consumerBpn, consumer.name, consumer.connectorName, c.startDate,
                c.expiryDate, c.purpose, c.agreementId, c.deployedTo, c.createdAt, c.updatedAt,
                offerings.policyView(c.policyId, odrl, c.rego), steps, log.stream().limit(20).map(decisions::view).toList());
    }

    private Contract save(Contract c) {
        c.updatedAt = clock.instant();
        return contracts.save(c);
    }

    private void log(Contract c, String detail) {
        audit.save(new AuditEvent(EventType.CONTRACT, c.consumerBpn, c.assetId, detail + " [" + c.consumerBpn + " / " + c.providerBpn + "]"));
    }

    private Participant participant(String bpn) {
        return participants.findById(bpn).orElseThrow();
    }

    private static void expect(Contract c, Status s) {
        if (c.status != s) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "contract " + c.id + " is " + c.status + ", expected " + s);
        }
    }
}
