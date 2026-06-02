/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * REED backend: source of truth for the REED manufacturing data space.
 *
 * <p>Persists the five additive REED tables (created on startup), serves the
 * confidential submodel payloads, and renders the EDC asset/policy/contract
 * payloads that the seed step pushes into the {@code reed-provider} connector.
 */
@SpringBootApplication
public class ReedBackendApplication {
    public static void main(String[] args) {
        SpringApplication.run(ReedBackendApplication.class, args);
    }
}
