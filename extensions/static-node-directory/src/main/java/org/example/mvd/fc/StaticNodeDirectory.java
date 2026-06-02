/*
 * Copyright (c) 2026 MVD Experiment
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.mvd.fc;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.edc.crawler.spi.TargetNode;
import org.eclipse.edc.crawler.spi.TargetNodeDirectory;
import org.eclipse.edc.spi.monitor.Monitor;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Reads the participants list from a JSON file whose path is supplied at
 * construction time, and exposes each entry as a {@link TargetNode} that the
 * Federated Catalog crawler will request a catalog from.
 *
 * <p>The file is re-read on every {@link #getAll()} call so that participants
 * can be added / removed / updated at runtime without restarting the FC - the
 * next crawl cycle will pick up the change. To protect against reading a
 * half-written file we:
 * <ul>
 *   <li>short-circuit when the file's last-modified timestamp has not changed
 *       since the previous successful read;</li>
 *   <li>on any parse / IO error, keep returning the last known-good list and
 *       log a warning instead of failing the crawl.</li>
 * </ul>
 *
 * <p>Expected file format (array of objects):
 * <pre>
 * [
 *   {
 *     "name": "provider",
 *     "id": "provider",
 *     "url": "http://provider:19194/protocol/2025-1",
 *     "supportedProtocols": ["dataspace-protocol-http:2025-1"]
 *   }
 * ]
 * </pre>
 */
public class StaticNodeDirectory implements TargetNodeDirectory {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Path participantsFile;
    private final Monitor monitor;
    private final AtomicReference<List<TargetNode>> lastGood = new AtomicReference<>(List.of());
    private volatile long lastModified = -1L;

    public StaticNodeDirectory(Path participantsFile, Monitor monitor) {
        this.participantsFile = participantsFile;
        this.monitor = monitor;
    }

    @Override
    public List<TargetNode> getAll() {
        try {
            if (!Files.exists(participantsFile)) {
                monitor.warning("StaticNodeDirectory: file does not exist yet: " + participantsFile
                        + " - returning cached list (" + lastGood.get().size() + " entries)");
                return lastGood.get();
            }

            // Short-circuit if the file hasn't changed since last successful read.
            var mtime = Files.getLastModifiedTime(participantsFile).toMillis();
            if (mtime == lastModified) {
                return lastGood.get();
            }

            var bytes = Files.readAllBytes(participantsFile);
            var parsed = MAPPER.readValue(bytes, new TypeReference<List<TargetNode>>() { });
            lastGood.set(List.copyOf(parsed));
            lastModified = mtime;
            monitor.debug("StaticNodeDirectory: reloaded " + parsed.size() + " participants from " + participantsFile);
            return parsed;
        } catch (IOException | RuntimeException e) {
            // Typical cause: the file is being rewritten. Keep the last-good list until the next cycle.
            monitor.warning("StaticNodeDirectory: could not read " + participantsFile
                    + " (" + e.getMessage() + ") - keeping cached list (" + lastGood.get().size() + " entries)");
            return lastGood.get();
        }
    }

    @Override
    public void insert(TargetNode node) {
        // file-backed directory is read-only through the SPI; edit the JSON to add nodes
    }

    @Override
    public TargetNode remove(String id) {
        // file-backed directory is read-only through the SPI; edit the JSON to remove nodes
        return null;
    }
}
