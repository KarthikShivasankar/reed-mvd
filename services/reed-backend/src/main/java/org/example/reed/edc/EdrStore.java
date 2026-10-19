/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.edc;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Endpoint data references (EDRs) delivered by the consumers' connectors through the
 * {@code transfer.process.started} callback, keyed by connector and transfer process. This replaces
 * polling the connectors' EDR cache API (v3 only in EDC 0.17.0).
 *
 * <p>ponytail: in memory with a TTL - EDRs are short-lived bearer tokens; persist (encrypted) only if
 * pulls must survive a backend restart.
 */
@Component
public class EdrStore {

    public record Edr(String connector, String transferProcessId, String endpoint, String authorization,
                      Instant receivedAt) {
    }

    private static final Duration TTL = Duration.ofHours(1);
    private final Map<String, Edr> edrs = new ConcurrentHashMap<>();

    public void put(Edr edr) {
        edrs.values().removeIf(e -> e.receivedAt().isBefore(Instant.now().minus(TTL)));
        edrs.put(edr.connector() + "/" + edr.transferProcessId(), edr);
    }

    public Optional<Edr> get(String connector, String transferProcessId) {
        return Optional.ofNullable(edrs.get(connector + "/" + transferProcessId))
                .filter(e -> e.receivedAt().isAfter(Instant.now().minus(TTL)));
    }
}
