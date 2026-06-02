/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

/**
 * Who may discover that an asset's metadata exists (the REED catalogue layer).
 *
 * <ul>
 *   <li>{@code consortium} - visible to every consortium member;</li>
 *   <li>{@code bilateral} - visible only to partners with a direct supply-chain
 *       relation to the owner;</li>
 *   <li>{@code project} - visible only to members of a shared project/pilot.</li>
 * </ul>
 */
public enum Discoverability {
    consortium,
    bilateral,
    project
}
