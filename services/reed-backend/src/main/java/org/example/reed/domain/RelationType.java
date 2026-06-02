/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

/** Kind of edge in the supply-chain graph between two BPNs. */
public enum RelationType {
    /** parentBpn owns / is the OEM for childBpn's parts. */
    OWNS,
    /** childBpn supplies parentBpn (a bilateral supplier link). */
    SUPPLIES,
    /** both BPNs are members of the same project/pilot. */
    PROJECT_MEMBER
}
