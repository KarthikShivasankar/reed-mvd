/*
 * IssuerService: issues MembershipCredential / CertificationCredential over DCP.
 * Attestations come from the stock "database" attestation source
 * (issuerservice-database-attestations, part of issuerservice-feature-sql-bom),
 * which SELECTs a row keyed by holder_id (= holder DID) from a named datasource.
 */

plugins {
    `java-library`
    id("application")
    alias(libs.plugins.shadow)
}

dependencies {
    runtimeOnly(libs.edc.bom.issuerservice)
    runtimeOnly(libs.edc.bom.issuerservice.sql)
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
    archiveFileName.set("issuerservice.jar")
    dependsOn(distTar, distZip)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
