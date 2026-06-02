/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.web;

import org.example.reed.domain.AssetClassification;
import org.example.reed.domain.PolicyTemplate;
import org.example.reed.repo.AssetClassificationRepository;
import org.example.reed.repo.PolicyTemplateRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Read access to the classification matrix and policy templates. */
@RestController
public class ClassificationController {

    private final AssetClassificationRepository classifications;
    private final PolicyTemplateRepository templates;

    public ClassificationController(AssetClassificationRepository classifications,
                                    PolicyTemplateRepository templates) {
        this.classifications = classifications;
        this.templates = templates;
    }

    @GetMapping("/reed/classifications")
    public List<AssetClassification> classifications() {
        return classifications.findAll();
    }

    @GetMapping("/reed/policy-templates")
    public List<PolicyTemplate> policyTemplates() {
        return templates.findAll();
    }
}
