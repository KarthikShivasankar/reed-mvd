/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Binds the {@code reed.*} settings from application.yaml. */
@Component
@ConfigurationProperties(prefix = "reed")
public class ReedProperties {

    /** Directory holding roster.json and scenarios/matchmaking.json. */
    private String deploymentDir = "/app/deployment";

    /** In-cluster base URL of this backend (used in rendered EDC data addresses). */
    private String internalUrl = "http://reed-backend:8080";

    /** {@code mock} (iam-mock, permissive EDC policies) or {@code dcp} (credential-constrained policies). */
    private String identityMode = "dcp";

    public String getDeploymentDir() {
        return deploymentDir;
    }

    public void setDeploymentDir(String deploymentDir) {
        this.deploymentDir = deploymentDir;
    }

    public String getInternalUrl() {
        return internalUrl;
    }

    public void setInternalUrl(String internalUrl) {
        this.internalUrl = internalUrl;
    }

    public String getIdentityMode() {
        return identityMode;
    }

    public void setIdentityMode(String identityMode) {
        this.identityMode = identityMode;
    }
}
