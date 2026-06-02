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

    /** Static key the EDC data-plane proxy presents to pull submodel payloads. */
    private String apiKey = "reed-submodel-key";

    /** BPN of the provider that owns the seeded assets (the OEM). */
    private String ownerBpn = "BPN-REED-OEM-0001";

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getOwnerBpn() {
        return ownerBpn;
    }

    public void setOwnerBpn(String ownerBpn) {
        this.ownerBpn = ownerBpn;
    }
}
