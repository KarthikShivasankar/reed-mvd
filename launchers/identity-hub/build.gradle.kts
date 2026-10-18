/*
 * Shared, multi-tenant IdentityHub (one participant context per connector):
 * DID documents (did:web), Credential Service (DCP presentation/storage API),
 * STS (self-issued ID tokens for the connectors), Identity (admin) API.
 * Postgres-backed; keys in HashiCorp Vault. Admin auth = static x-api-key.
 */

plugins {
    `java-library`
    id("application")
    alias(libs.plugins.shadow)
}

dependencies {
    runtimeOnly(libs.edc.bom.identityhub)
    runtimeOnly(libs.edc.bom.identityhub.sql)
    runtimeOnly(libs.edc.vault.hashicorp)
    runtimeOnly(project(":extensions:superuser-seed"))
}

application {
    mainClass.set("org.eclipse.edc.boot.system.runtime.BaseRuntime")
}

val distTar = tasks.named("distTar")
val distZip = tasks.named("distZip")

tasks.shadowJar {
    mergeServiceFiles()
    archiveFileName.set("identity-hub.jar")
    dependsOn(distTar, distZip)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
