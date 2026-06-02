/*
 * REED backend: a Spring Boot service that is the source of truth for the
 * REED data model. It persists the five REED tables in Postgres, serves the
 * confidential submodel payloads, and renders the EDC asset/policy/contract
 * payloads that seed-reed.sh pushes into the reed-provider connector.
 *
 * This module is intentionally independent of the EDC BOMs used by the
 * connector/federated-catalog launchers - it only shares the Java 17 toolchain
 * applied by the root build.
 */

plugins {
    java
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    runtimeOnly(libs.postgresql)
}

springBoot {
    mainClass.set("org.example.reed.ReedBackendApplication")
}

tasks.bootJar {
    archiveFileName.set("reed-backend.jar")
}
