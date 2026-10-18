/*
 * Standalone Federated Catalog runtime.
 *
 * As of EDC 0.17.0 the Federated Catalog core + API modules are shipped inside
 * the Connector repo and wired up by controlplane-base-bom. We therefore build
 * the FC runtime on top of controlplane-dcp-bom (base + DCP) - this gives us the
 * management web context that the CatalogsApi controller relies on.
 */

plugins {
    `java-library`
    id("application")
    alias(libs.plugins.shadow)
}

dependencies {
    // controlplane-dcp-bom = controlplane-base-bom + DCP identity. The crawler
    // presents its own credentials, so the FC needs its own IdentityHub
    // participant context + MembershipCredential (like any connector).
    runtimeOnly(libs.edc.bom.controlplane.dcp)
    runtimeOnly(project(":extensions:static-node-directory"))

    runtimeOnly(libs.edc.vault.hashicorp)
}

application {
    mainClass.set("org.eclipse.edc.boot.system.runtime.BaseRuntime")
}

val distTar = tasks.named("distTar")
val distZip = tasks.named("distZip")

tasks.shadowJar {
    mergeServiceFiles()
    archiveFileName.set("federated-catalog.jar")
    dependsOn(distTar, distZip)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
