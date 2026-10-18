/*
 * Bootstraps the admin ("super-user") participant context in IdentityHub /
 * IssuerService so the identity + issuer-admin APIs can be driven with a known
 * x-api-key. EDC 0.17.0 ships no such seeder for the non-OAuth2 BOMs (upstream
 * MVD switched to Keycloak); this is the old MVD superuser-seed, ported.
 */

plugins {
    `java-library`
}

dependencies {
    implementation(libs.edc.ih.spi)
    implementation(libs.edc.runtime.metamodel)
}
