/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.config;

import java.util.Set;

/**
 * Well-known demo BPNs (Business Partner Numbers).
 *
 * <ul>
 *   <li>{@link #OEM} - the provider running this backend (owns the assets);</li>
 *   <li>{@link #SUPPLIER} - the partner the {@code consumer-1} connector
 *       represents; has a direct supply relation to the OEM (sees bilateral);</li>
 *   <li>{@link #SIM_SERVICE} - a simulation service; shares a project with the
 *       OEM (sees project-scoped) but has no supply relation;</li>
 *   <li>{@link #OUTSIDER} - a consortium member with no direct relation to the
 *       OEM (sees consortium-only).</li>
 * </ul>
 */
public final class Bpns {

    public static final String OEM = "BPN-REED-OEM-0001";
    public static final String SUPPLIER = "BPN-REED-SUP-0002";
    public static final String SIM_SERVICE = "BPN-REED-SIM-0003";
    public static final String OUTSIDER = "BPN-REED-OUT-9999";

    /** Membership of the REED consortium (anyone outside this set discovers nothing). */
    public static final Set<String> CONSORTIUM = Set.of(OEM, SUPPLIER, SIM_SERVICE, OUTSIDER);

    private Bpns() {
    }
}
