/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.domain;

/** How sensitive the payload is. Ordered least → most restrictive. */
public enum Sensitivity {
    consortium,
    confidential,
    restricted,
    regulated
}
