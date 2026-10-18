/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.edc.EdcRenderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Serves the EDC Management API payloads rendered from the REED data model for
 * one owner ({@code ?owner=<bpn>}). {@code seed-reed.sh} (admin token) GETs each
 * list per participant and POSTs the elements to that participant's connector.
 */
@RestController
@RequestMapping("/reed/edc")
public class EdcRenderController {

    private final EdcRenderService edc;

    public EdcRenderController(EdcRenderService edc) {
        this.edc = edc;
    }

    @GetMapping("/assets")
    public List<Map<String, Object>> assets(@RequestParam String owner) {
        return edc.assets(owner);
    }

    @GetMapping("/policydefinitions")
    public List<Map<String, Object>> policyDefinitions(@RequestParam String owner) {
        return edc.policyDefinitions(owner);
    }

    @GetMapping("/celexpressions")
    public List<Map<String, Object>> celExpressions() {
        return edc.celExpressions();
    }

    @GetMapping("/contractdefinitions")
    public List<Map<String, Object>> contractDefinitions(@RequestParam String owner) {
        return edc.contractDefinitions(owner);
    }
}
