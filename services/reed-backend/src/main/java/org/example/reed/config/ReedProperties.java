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

    /** Static key the EDC data-plane proxies present to pull submodel payloads. */
    private String apiKey = "reed-submodel-key";

    /** Directory holding roster.json and scenarios/matchmaking.json. */
    private String deploymentDir = "/app/deployment";

    /** In-cluster base URL of this backend (used in rendered EDC data addresses). */
    private String internalUrl = "http://reed-backend:8080";

    /** {@code mock} (iam-mock, permissive EDC policies) or {@code dcp} (credential-constrained policies). */
    private String identityMode = "dcp";

    public String getApiKey() {
        return apiKey;
    }

    /**
     * The key one owner's data plane presents to the submodel service: HMAC-SHA256 of the
     * owner's BPN under the master {@code apiKey}. A participant that reads its own asset data
     * addresses learns only its own key, which unlocks only its own payloads.
     */
    public String ownerKey(String ownerBpn) {
        try {
            var mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(apiKey.getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
            return java.util.HexFormat.of().formatHex(mac.doFinal(ownerBpn.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

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
