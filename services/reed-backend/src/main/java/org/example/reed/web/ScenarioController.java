/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.config.ReedProperties;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Health probe and the public real-case scenario fixtures (no company-internal data). */
@RestController
public class ScenarioController {

    private final ReedProperties props;

    public ScenarioController(ReedProperties props) {
        this.props = props;
    }

    @GetMapping("/reed/health")
    public Map<String, String> health() {
        return Map.of("status", "UP", "identityMode", props.getIdentityMode());
    }

    @GetMapping(value = "/reed/scenarios", produces = MediaType.APPLICATION_JSON_VALUE)
    public String scenarios() throws IOException {
        return Files.readString(Path.of(props.getDeploymentDir(), "scenarios", "matchmaking.json"));
    }

    /** Cross-border data-sharing stories (owner terms -> who gets a contract), see run-interop.sh. */
    @GetMapping(value = "/reed/scenarios/interop", produces = MediaType.APPLICATION_JSON_VALUE)
    public String interop() throws IOException {
        return Files.readString(Path.of(props.getDeploymentDir(), "scenarios", "interop.json"));
    }
}
