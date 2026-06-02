/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.repo;

import org.example.reed.domain.PolicyTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PolicyTemplateRepository extends JpaRepository<PolicyTemplate, String> {
}
