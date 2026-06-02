/*
 * Connector launcher: a collocated control-plane + data-plane runtime.
 * Used by both the provider and the consumer; they differ only by
 * the config.properties mounted at runtime.
 */

plugins {
    `java-library`
    id("application")
    alias(libs.plugins.shadow)
}

dependencies {
    // Everything needed to run a collocated CP+DP connector comes from these BOMs.
    runtimeOnly(libs.edc.bom.controlplane.base)
    runtimeOnly(libs.edc.bom.dataplane.base)

    // Consumer-side EDR query API (/management/v3/edrs/{tpId}/dataaddress)
    runtimeOnly(libs.edc.edr.cache.api)

    // EDR cache API v4 (newer path)
    // Registers the HttpData endpoint generator + public pull-proxy controller.
    // Required because EDC 0.17.0 removed data-plane-public-api.
    runtimeOnly(project(":extensions:http-pull-proxy"))

    // IAM mock (demo-only; replaces DCP/IdentityHub)
    runtimeOnly(libs.edc.iam.mock)

    // Secret store
    runtimeOnly(libs.edc.vault.hashicorp)
}

application {
    mainClass.set("org.eclipse.edc.boot.system.runtime.BaseRuntime")
}

val distTar = tasks.named("distTar")
val distZip = tasks.named("distZip")

tasks.shadowJar {
    mergeServiceFiles()
    archiveFileName.set("connector.jar")
    dependsOn(distTar, distZip)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
