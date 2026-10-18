/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.assistant;

import org.example.reed.repo.ParticipantRepository;
import org.example.reed.repo.RfqRepository;
import org.example.reed.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** HTTP surface of the local-LLM matchmaking assistant (consortium members only). */
@RestController
public class AssistantController {

    public record DraftForm(String text) {
    }

    public record ChatForm(List<Map<String, String>> messages) {
    }

    private final AssistantService assistant;
    private final RfqRepository rfqs;
    private final ParticipantRepository participants;

    public AssistantController(AssistantService assistant, RfqRepository rfqs, ParticipantRepository participants) {
        this.assistant = assistant;
        this.rfqs = rfqs;
        this.participants = participants;
    }

    @PostMapping("/reed/assistant/rfq-draft")
    public AssistantService.DraftResponse draft(@AuthenticationPrincipal Jwt jwt, @RequestBody DraftForm f) {
        var user = member(jwt);
        if (f.text() == null || f.text().isBlank() || f.text().length() > 4000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "text is required (max 4000 characters)");
        }
        return assistant.draftRfq(f.text(), user.bpn(), personNames(jwt));
    }

    @PostMapping("/reed/assistant/explain/{rfqId}")
    public AssistantService.Explanation explain(@AuthenticationPrincipal Jwt jwt, @PathVariable String rfqId) {
        var user = member(jwt);
        var rfq = rfqs.findById(rfqId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown RFQ"));
        if (!rfq.buyerBpn.equals(user.bpn()) && !user.canImpersonateView()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only the buyer gets the ranking explained");
        }
        return assistant.explain(rfq, user.bpn());
    }

    @PostMapping("/reed/assistant/chat")
    public AssistantService.ChatReply chat(@AuthenticationPrincipal Jwt jwt, @RequestBody ChatForm f) {
        var user = member(jwt);
        if (f.messages() == null || f.messages().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "messages are required");
        }
        return assistant.chat(f.messages(), user.bpn(), user.canImpersonateView(), personNames(jwt));
    }

    private CurrentUser member(Jwt jwt) {
        var user = CurrentUser.of(jwt);
        if (user.isAdmin()) {
            return user;
        }
        if (!participants.existsByBpnAndConsortiumTrue(user.requireBpn())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, user.bpn() + " is not a REED consortium member");
        }
        return user;
    }

    /**
     * The caller's own identifying claims (full name, username, e-mail), so they can be scrubbed from free
     * text before it reaches the model. Given/family names alone are not used: as single words they
     * collide with ordinary vocabulary and company names.
     */
    private static List<String> personNames(Jwt jwt) {
        var out = new ArrayList<String>();
        for (var claim : List.of("name", "preferred_username", "email")) {
            var v = jwt.getClaimAsString(claim);
            if (v != null) {
                out.add(v);
            }
        }
        return out;
    }
}
