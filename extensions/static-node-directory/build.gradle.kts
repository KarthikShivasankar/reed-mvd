/*
 * Tiny EDC extension that loads a list of participants from a JSON file
 * and exposes them as TargetNodes to the Federated Catalog crawler.
 */

plugins {
    `java-library`
}

dependencies {
    implementation(libs.edc.crawler.spi)
    implementation(libs.edc.runtime.metamodel)
}
