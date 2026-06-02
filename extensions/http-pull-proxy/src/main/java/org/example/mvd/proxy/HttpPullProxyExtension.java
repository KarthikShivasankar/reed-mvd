/*
 * Copyright (c) 2026 MVD Experiment
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.mvd.proxy;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.eclipse.edc.connector.dataplane.spi.Endpoint;
import org.eclipse.edc.connector.dataplane.spi.iam.DataPlaneAuthorizationService;
import org.eclipse.edc.connector.dataplane.spi.iam.PublicEndpointGeneratorService;
import org.eclipse.edc.runtime.metamodel.annotation.Extension;
import org.eclipse.edc.runtime.metamodel.annotation.Inject;
import org.eclipse.edc.runtime.metamodel.annotation.Setting;
import org.eclipse.edc.spi.system.ServiceExtension;
import org.eclipse.edc.spi.system.ServiceExtensionContext;
import org.eclipse.edc.web.spi.WebService;
import org.eclipse.edc.web.spi.configuration.PortMapping;
import org.eclipse.edc.web.spi.configuration.PortMappingRegistry;

import java.io.IOException;
import java.util.Collections;

import static jakarta.ws.rs.core.MediaType.WILDCARD;
import static jakarta.ws.rs.core.Response.Status.FORBIDDEN;
import static jakarta.ws.rs.core.Response.Status.INTERNAL_SERVER_ERROR;
import static jakarta.ws.rs.core.Response.Status.UNAUTHORIZED;
import static org.eclipse.edc.spi.constants.CoreConstants.EDC_NAMESPACE;

/**
 * Registers:
 * <ul>
 *   <li>a {@link PublicEndpointGeneratorService} function for "HttpData"
 *       that maps to the configured public proxy URL; and</li>
 *   <li>a JAX-RS controller at the {@code public} web context that acts
 *       as an EDR-authorized reverse proxy for the underlying HttpData
 *       source.</li>
 * </ul>
 */
@Extension(value = HttpPullProxyExtension.NAME)
public class HttpPullProxyExtension implements ServiceExtension {

    public static final String NAME = "MVD HttpData PULL proxy";
    private static final String PUBLIC_CONTEXT = "public";

    @Setting(description = "Public base URL the provider advertises in EDRs",
            key = "edc.dataplane.api.public.baseurl")
    private String publicBaseUrl;

    @Setting(description = "Port to bind the public pull-proxy context to",
            key = "web.http.public.port",
            defaultValue = "19291")
    private int publicPort;

    @Setting(description = "Context path of the public pull-proxy context",
            key = "web.http.public.path",
            defaultValue = "/public")
    private String publicPath;

    @Inject
    private PublicEndpointGeneratorService generatorService;
    @Inject
    private DataPlaneAuthorizationService authorizationService;
    @Inject
    private WebService webService;
    @Inject
    private PortMappingRegistry portMappingRegistry;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public void initialize(ServiceExtensionContext context) {
        var proxyUrl = publicBaseUrl;
        context.getMonitor().info("HttpPullProxy: registering HttpData endpoint generator -> " + proxyUrl);

        portMappingRegistry.register(new PortMapping(PUBLIC_CONTEXT, publicPort, publicPath));

        generatorService.addGeneratorFunction("HttpData", address -> Endpoint.url(proxyUrl));
        generatorService.addResponseGeneratorFunction("HttpData", () -> Endpoint.url(proxyUrl));

        webService.registerResource(PUBLIC_CONTEXT, new ProxyController(authorizationService));
    }

    @Path("{any:.*}")
    @Consumes(WILDCARD)
    @Produces(WILDCARD)
    public static class ProxyController {

        private static final OkHttpClient CLIENT = new OkHttpClient();
        private final DataPlaneAuthorizationService authorizationService;

        public ProxyController(DataPlaneAuthorizationService authorizationService) {
            this.authorizationService = authorizationService;
        }

        @GET
        public Response get(@Context ContainerRequestContext requestContext) {
            var token = requestContext.getHeaderString(HttpHeaders.AUTHORIZATION);
            if (token == null) {
                return Response.status(UNAUTHORIZED).build();
            }

            var result = authorizationService.authorize(token, Collections.emptyMap());
            if (result.failed()) {
                return Response.status(FORBIDDEN).entity(result.getFailureDetail()).build();
            }

            var src = result.getContent();
            var baseUrl = src.getStringProperty(EDC_NAMESPACE + "baseUrl");
            if (baseUrl == null) {
                return Response.status(INTERNAL_SERVER_ERROR)
                        .entity("resolved DataAddress has no baseUrl").build();
            }

            // Honour the additional DataAddress properties that EDC's stock
            // HttpData source supports, so a provider can publish assets that:
            //   * embed canonical query parameters in `queryParams`
            //     (e.g. "dataspace_uri=<encoded>&node_uri=<encoded>&depth=1"),
            //   * opt-in to forwarding of the inbound request's query string
            //     via `proxyQueryParams="true"`,
            //   * inline a static auth header for the upstream backend via
            //     `authKey`/`authCode` — for example `Authorization` with a
            //     Bearer JWT, or `X-Api-Key` with a static API key (the model
            //     REED uses to authenticate to its submodel service).
            // Without these, this controller could only proxy unauthenticated,
            // parameterless GETs.
            var staticQuery = src.getStringProperty(EDC_NAMESPACE + "queryParams");
            var proxyQueryParams = "true".equalsIgnoreCase(
                    src.getStringProperty(EDC_NAMESPACE + "proxyQueryParams"));
            var authKey = src.getStringProperty(EDC_NAMESPACE + "authKey");
            var authCode = src.getStringProperty(EDC_NAMESPACE + "authCode");

            var url = baseUrl;
            if (staticQuery != null && !staticQuery.isBlank()) {
                url = url + (url.contains("?") ? "&" : "?") + staticQuery;
            }
            if (proxyQueryParams) {
                var incoming = requestContext.getUriInfo().getRequestUri().getRawQuery();
                if (incoming != null && !incoming.isBlank()) {
                    url = url + (url.contains("?") ? "&" : "?") + incoming;
                }
            }

            var builder = new Request.Builder().url(url).get();
            if (authKey != null && !authKey.isBlank() && authCode != null) {
                builder.addHeader(authKey, authCode);
            }
            var req = builder.build();
            try (var resp = CLIENT.newCall(req).execute()) {
                var body = resp.body() != null ? resp.body().bytes() : new byte[0];
                var contentType = resp.header("Content-Type", "application/octet-stream");
                return Response.status(resp.code()).type(contentType).entity(body).build();
            } catch (IOException e) {
                return Response.status(INTERNAL_SERVER_ERROR)
                        .entity("proxy error: " + e.getMessage()).build();
            }
        }
    }
}
