/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.participant;

import org.example.reed.domain.Participant;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.TreeSet;

/**
 * Decides which certifications of a participant count as <em>verified</em> for
 * matchmaking hard filters. A certification is verified when a trusted body
 * attested it in the REED registry; under DCP that same attestation is what
 * the Issuer Service signs into the participant's {@code CertificationCredential},
 * which the EDC connectors check during negotiation. Self-declared
 * {@code claimedCerts} on the capability never count.
 */
@Component
public class CredentialVerifier {

    public Set<String> verifiedCerts(Participant p) {
        return p.attestations == null ? Set.of() : new TreeSet<>(p.attestations);
    }
}
