/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Minimal OpenAI-compatible chat client for the <b>local</b> LLM gateway: a
 * LiteLLM proxy that routes the {@code reed-llm} alias to Qwen3.8 on Ollama
 * (default) or vLLM. No data leaves the deployment. Any failure returns
 * {@link Optional#empty()} so callers fall back to deterministic rules.
 */
@Component
public class LlmClient {

    private static final Logger LOG = LoggerFactory.getLogger(LlmClient.class);

    private final RestClient http;
    private final ObjectMapper mapper;
    private final String model;
    private final boolean enabled;

    public LlmClient(ObjectMapper mapper,
                     @Value("${reed.llm.base-url}") String baseUrl,
                     @Value("${reed.llm.api-key}") String apiKey,
                     @Value("${reed.llm.model}") String model,
                     @Value("${reed.llm.enabled}") boolean enabled,
                     @Value("${reed.llm.timeout-seconds}") int timeoutSeconds) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3_000);
        factory.setReadTimeout(timeoutSeconds * 1000);
        this.http = RestClient.builder().requestFactory(factory).baseUrl(baseUrl)
                .defaultHeader("Authorization", "Bearer " + apiKey).build();
        this.mapper = mapper;
        this.model = model;
        this.enabled = enabled;
    }

    public String model() {
        return model;
    }

    /** The route stays on our own hardware (Ollama or vLLM); the frontier routes in litellm/config.yaml do not. */
    public boolean local() {
        return model.equals("reed-llm") || model.equals("reed-llm-vllm");  // ponytail: the two local aliases of litellm/config.yaml
    }

    /**
     * One chat completion. {@code tools} and {@code jsonSchema} are optional.
     * Returns the assistant message ({@code content} and/or {@code tool_calls}).
     */
    public Optional<JsonNode> chat(List<Map<String, Object>> messages, List<Map<String, Object>> tools,
                                   Map<String, Object> jsonSchema) {
        if (!enabled) {
            return Optional.empty();
        }
        var body = new LinkedHashMap<String, Object>();
        body.put("model", model);
        body.put("temperature", 0);
        body.put("messages", messages);
        if (tools != null && !tools.isEmpty()) {
            body.put("tools", tools);
        }
        if (jsonSchema != null) {
            body.put("response_format", Map.of("type", "json_schema",
                    "json_schema", Map.of("name", "reed_output", "strict", true, "schema", jsonSchema)));
        }
        try {
            var res = http.post().uri("/chat/completions").contentType(MediaType.APPLICATION_JSON)
                    .body(mapper.writeValueAsString(body)).retrieve().body(String.class);
            return Optional.of(mapper.readTree(res).path("choices").path(0).path("message"));
        } catch (Exception e) {
            LOG.warn("LLM gateway call failed ({}); falling back to rules", e.getMessage());
            return Optional.empty();
        }
    }

    /** Parses a JSON content string from a structured-output reply. */
    public Optional<JsonNode> json(JsonNode message) {
        try {
            var content = message.path("content").asText("");
            var start = content.indexOf('{');
            var end = content.lastIndexOf('}');
            return start < 0 || end < start ? Optional.empty()
                    : Optional.of(mapper.readTree(content.substring(start, end + 1)));
        } catch (Exception e) {
            return Optional.empty();
        }
    }
}
