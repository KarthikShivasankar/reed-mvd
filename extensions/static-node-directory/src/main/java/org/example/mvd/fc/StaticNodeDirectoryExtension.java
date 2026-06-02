/*
 * Copyright (c) 2026 MVD Experiment
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.mvd.fc;

import org.eclipse.edc.crawler.spi.TargetNodeDirectory;
import org.eclipse.edc.runtime.metamodel.annotation.Extension;
import org.eclipse.edc.runtime.metamodel.annotation.Provides;
import org.eclipse.edc.runtime.metamodel.annotation.Setting;
import org.eclipse.edc.spi.system.ServiceExtension;
import org.eclipse.edc.spi.system.ServiceExtensionContext;

import java.nio.file.Path;

@Extension(value = StaticNodeDirectoryExtension.NAME)
@Provides(TargetNodeDirectory.class)
public class StaticNodeDirectoryExtension implements ServiceExtension {

    public static final String NAME = "Static Node Directory Extension";

    @Setting(description = "Filesystem path to the participants.json file",
            key = "edc.mvd.participants.file")
    private String participantsFile;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public void initialize(ServiceExtensionContext context) {
        var path = Path.of(participantsFile);
        context.getMonitor().info("StaticNodeDirectory: loading participants from " + path
                + " (file is re-read on every crawl cycle - edit it to add/remove participants)");
        context.registerService(TargetNodeDirectory.class, new StaticNodeDirectory(path, context.getMonitor()));
    }
}
