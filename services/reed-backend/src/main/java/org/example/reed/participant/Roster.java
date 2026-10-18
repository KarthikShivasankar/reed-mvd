/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.participant;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.reed.domain.CapabilityClaim;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * The deployment roster ({@code deployment/roster.json}) and matchmaking
 * scenarios ({@code deployment/scenarios/matchmaking.json}) as typed records.
 * The same files drive the topology generator, the backend seeder, the unit
 * tests and the end-to-end script, so there is exactly one place to change.
 */
public final class Roster {

    private Roster() {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record File(List<ParticipantSpec> participants, List<UserSpec> adminUsers) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ParticipantSpec(String bpn, String name, @JsonProperty("short") String shortName, String role, Boolean consortium,
                                  String country, String city, String vatId, double lat, double lon,
                                  boolean portAccess, boolean railAccess, List<String> sectors,
                                  ConnectorSpec connector, String identity, List<String> attestations,
                                  List<RelationSpec> relations, CapabilityClaim capability,
                                  JsonNode confidentialCapability, List<String> assets,
                                  List<HistorySpec> history, List<UserSpec> users) {

        public boolean member() {
            return consortium == null || consortium;
        }

        public List<String> attestations() {
            return attestations == null ? List.of() : attestations;
        }

        public List<RelationSpec> relations() {
            return relations == null ? List.of() : relations;
        }

        public List<String> assets() {
            return assets == null ? List.of() : assets;
        }

        public List<HistorySpec> history() {
            return history == null ? List.of() : history;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ConnectorSpec(String name, String portPrefix) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RelationSpec(String type, String to) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record HistorySpec(String buyer, boolean onTime, boolean qualityOk) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UserSpec(String username, List<String> roles) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Scenarios(List<RfqSpec> rfqs, List<JsonNode> negative) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RfqSpec(String id, String chain, String buyer, String title, String story, String sector,
                          String partFamily, String material, List<Integer> dimsMm, double massKg, Double tolMm,
                          int quantity, int dueInWeeks, Double deliveryLat, Double deliveryLon,
                          List<String> requiredProcesses, List<String> requiredCerts,
                          List<String> partnerProcesses, String expectedTop, String expectedSecond,
                          Map<String, List<String>> expectedRejections, Map<String, String> expectedPartners) {

        public List<String> partnerProcesses() {
            return partnerProcesses == null ? List.of() : partnerProcesses;
        }

        public List<String> requiredCerts() {
            return requiredCerts == null ? List.of() : requiredCerts;
        }
    }

    public static File load(ObjectMapper mapper, Path path) throws IOException {
        return mapper.readValue(path.toFile(), File.class);
    }

    public static Scenarios loadScenarios(ObjectMapper mapper, Path path) throws IOException {
        return mapper.readValue(path.toFile(), Scenarios.class);
    }
}
