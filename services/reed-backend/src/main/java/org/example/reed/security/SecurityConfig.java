/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;

import java.util.Collection;

/**
 * OAuth2 resource server: every {@code /reed/**} call needs a Keycloak access
 * token, except the submodel service (called by EDC data planes with its own
 * static key, only after a contract) and the health/scenario endpoints.
 *
 * <p>Keys are fetched in-cluster ({@code reed.security.jwk-set-uri}) while the
 * issuer is validated against the browser-facing URL
 * ({@code reed.security.issuer}) - deliberately not {@code issuer-uri}
 * discovery, which would need the browser URL to resolve inside Docker.
 */
@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        var roles = new JwtAuthenticationConverter();
        roles.setJwtGrantedAuthoritiesConverter(SecurityConfig::realmRoles);
        http.cors(Customizer.withDefaults())
                .csrf(c -> c.disable()) // stateless bearer-token API, no cookies
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/reed/submodels/**", "/reed/health", "/reed/scenarios").permitAll()
                        .requestMatchers("/reed/edc/**").hasRole("admin")
                        .anyRequest().authenticated())
                .oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(roles)));
        return http.build();
    }

    @Bean
    JwtDecoder jwtDecoder(@Value("${reed.security.jwk-set-uri}") String jwkSetUri,
                          @Value("${reed.security.issuer}") String issuer,
                          @Value("${reed.security.audience}") String audience) {
        var decoder = NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuer),
                jwt -> jwt.getAudience() != null && jwt.getAudience().contains(audience)
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token",
                        "token audience must contain " + audience, null))));
        return decoder;
    }

    private static Collection<GrantedAuthority> realmRoles(Jwt jwt) {
        return CurrentUser.of(jwt).roles().stream()
                .map(r -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + r))
                .toList();
    }
}
