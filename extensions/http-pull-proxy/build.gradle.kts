/*
 * EDC 0.17.0 removed the data-plane-public-api module. This tiny extension
 * fills the gap for a simple HttpData-PULL consumer demo:
 *   1. registers a PublicEndpointGeneratorService function for "HttpData"
 *      pointing at the configured public proxy URL
 *   2. registers a JAX-RS controller at the "public" web context that
 *      authorizes the incoming EDR token, looks up the source DataAddress,
 *      fetches the data over HTTP, and streams it back to the caller
 */

plugins {
    `java-library`
}

dependencies {
    implementation(libs.edc.runtime.metamodel)
    compileOnly("org.eclipse.edc:data-plane-spi:0.17.0")
    compileOnly("org.eclipse.edc:web-spi:0.17.0")
    compileOnly("org.eclipse.edc:core-spi:0.17.0")
    compileOnly("org.eclipse.edc:transform-spi:0.17.0")
    compileOnly("jakarta.ws.rs:jakarta.ws.rs-api:4.0.0")
    compileOnly("com.squareup.okhttp3:okhttp:5.3.2")
    compileOnly("org.eclipse.edc:http-spi:0.17.0")
}
