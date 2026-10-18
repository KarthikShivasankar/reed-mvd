/*
 * Connector launcher: a collocated control-plane + data-plane runtime.
 * Used by every participant; they differ only by the config.properties
 * mounted at runtime.
 *
 * Identity: DCP (Decentralized Claims Protocol). The connector obtains
 * self-issued ID tokens from the shared IdentityHub's STS and verifies
 * counter-party Verifiable Presentations against trusted issuers.
 */

plugins {
    `java-library`
    id("application")
    alias(libs.plugins.shadow)
}

dependencies {
    // control-plane + DCP identity (did:web resolution, STS remote client, VC/VP verification)
    runtimeOnly(libs.edc.bom.controlplane.dcp)
    runtimeOnly(libs.edc.bom.dataplane.base)

    // Credential-constrained policies: CEL expressions over ctx.agent.claims.vc,
    // registered at runtime via POST /management/v5beta/celexpressions (in-memory store).
    runtimeOnly(libs.edc.cel.core)
    runtimeOnly(libs.edc.cel.api.v5)
    runtimeOnly(libs.edc.dcp.cel)

    // Consumer-side EDR query API (/management/v3/edrs/{tpId}/dataaddress)
    runtimeOnly(libs.edc.edr.cache.api)

    // Registers the HttpData endpoint generator + public pull-proxy controller.
    // Required because EDC 0.17.0 removed data-plane-public-api.
    runtimeOnly(project(":extensions:http-pull-proxy"))

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
