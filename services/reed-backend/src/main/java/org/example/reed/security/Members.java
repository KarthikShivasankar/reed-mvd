/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.security;

import org.example.reed.repo.ParticipantRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Who is acting: the caller's organisation always comes from the token, and must be an active member. */
@Component
public class Members {

    private final ParticipantRepository participants;

    public Members(ParticipantRepository participants) {
        this.participants = participants;
    }

    /** The caller's BPN if its organisation is an active consortium member, else 403. */
    public String member(CurrentUser user) {
        var bpn = user.requireBpn();
        if (!participants.existsByBpnAndConsortiumTrue(bpn)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, bpn + " is not an active REED consortium member");
        }
        return bpn;
    }

    /** A member's BPN, or null for the dataspace operator (who sees every organisation's view). */
    public String memberOrOperator(CurrentUser user) {
        return user.canImpersonateView() ? null : member(user);
    }
}
