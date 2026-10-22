/*
 * REED backend: a Spring Boot service that is the source of truth for the
 * REED data model. It persists the REED tables in Postgres (Flyway-managed),
 * serves the confidential submodel payloads, runs matchmaking and the local-LLM
 * assistant, proxies the EDC Management APIs for logged-in users, and renders
 * the EDC asset/policy/contract payloads that seed-reed.sh pushes into every
 * participant's connector.
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
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.flywaydb:flyway-core")
    implementation("org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5")  // shop-floor sensors over MQTT
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly(libs.postgresql)

    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

springBoot {
    mainClass.set("org.example.reed.ReedBackendApplication")
}

tasks.bootJar {
    archiveFileName.set("reed-backend.jar")
}

tasks.test {
    useJUnitPlatform()
    // Scenario fixtures live in deployment/ (single source shared with the stack).
    val deployment = rootProject.layout.projectDirectory.dir("deployment")
    systemProperty("reed.deployment", deployment.asFile.absolutePath)
    // re-run the scenario tests whenever the roster or the scenarios change
    inputs.file(deployment.file("roster.json"))
    inputs.dir(deployment.dir("scenarios"))
}
