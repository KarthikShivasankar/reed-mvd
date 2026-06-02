/*
 * Standalone Federated Catalog runtime.
 *
 * As of EDC 0.17.0 the Federated Catalog core + API modules are shipped inside
 * the Connector repo and wired up by controlplane-base-bom. We therefore build
 * the FC runtime on top of controlplane-base-bom too - this gives us the
 * management web context that the CatalogsApi controller relies on.
 */

plugins {
    `java-library`
    id("application")
    alias(libs.plugins.shadow)
}

dependencies {
    runtimeOnly(libs.edc.bom.controlplane.base)
    runtimeOnly(project(":extensions:static-node-directory"))

    implementation(libs.edc.iam.mock)
    implementation(libs.edc.vault.hashicorp)
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
