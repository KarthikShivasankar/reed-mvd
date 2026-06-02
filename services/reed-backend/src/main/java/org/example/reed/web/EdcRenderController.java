/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.edc.EdcRenderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Serves the EDC Management API payloads rendered from the REED data model.
 * {@code seed-reed.sh} GETs each list and POSTs the elements to the connector.
 */
@RestController
@RequestMapping("/reed/edc")
public class EdcRenderController {

    private final EdcRenderService edc;

    public EdcRenderController(EdcRenderService edc) {
        this.edc = edc;
    }

    @GetMapping("/assets")
    public List<Map<String, Object>> assets() {
        return edc.assets();
    }

    @GetMapping("/policydefinitions")
    public List<Map<String, Object>> policyDefinitions() {
        return edc.policyDefinitions();
    }

    @GetMapping("/contractdefinitions")
    public List<Map<String, Object>> contractDefinitions() {
        return edc.contractDefinitions();
    }
}
