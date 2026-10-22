/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.factory;

import jakarta.servlet.http.HttpServletResponse;
import org.example.reed.assistant.AssistantController;
import org.example.reed.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;

/**
 * The shop-floor view of a company's line. The line is the caller's own organisation's (from the token);
 * only the dataspace operator may pick another company's line ({@code ?participant=}), read-only.
 */
@RestController
public class FactoryController {

    public record ObservationForm(String text, String machineId) {
    }

    public record ControlForm(String action, String machineId, String sensorId) {
    }

    private final FactoryService factory;

    public FactoryController(FactoryService factory) {
        this.factory = factory;
    }

    @GetMapping("/reed/factory")
    public FactoryService.LineView line(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String participant) {
        return factory.line(resolve(jwt, participant));
    }

    @GetMapping("/reed/factory/series")
    public List<FactoryService.SeriesPoint> series(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String participant,
                                                   @RequestParam String key, @RequestParam(defaultValue = "1h") String range) {
        return factory.series(resolve(jwt, participant), key, range);
    }

    @GetMapping("/reed/factory/insights")
    public List<TrendAnalyzer.Insight> insights(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String participant) {
        return factory.insights(resolve(jwt, participant));
    }

    @GetMapping("/reed/factory/observations")
    public List<FactoryService.ObservationView> observations(@AuthenticationPrincipal Jwt jwt,
                                                             @RequestParam(required = false) String participant) {
        var line = resolve(jwt, participant);
        return factory.observations(line, own(jwt, line));
    }

    /** Only the company's own people report on its line. */
    @PostMapping("/reed/factory/observations")
    public FactoryService.ObservationView observe(@AuthenticationPrincipal Jwt jwt, @RequestBody ObservationForm f) {
        var user = CurrentUser.of(jwt);
        if (!factory.hasLine(user.participant())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only people of a company with a shop-floor line can report on it");
        }
        return factory.observe(user.participant(), f.text(), f.machineId(), user.username(), user.bpn(),
                AssistantController.personNames(jwt));
    }

    /** Only the company's own people steer its line; the operator watches. */
    @PostMapping("/reed/factory/control")
    public Map<String, Object> control(@AuthenticationPrincipal Jwt jwt, @RequestBody ControlForm f) {
        var user = CurrentUser.of(jwt);
        if (!factory.hasLine(user.participant())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only people of a company with a shop-floor line can steer it");
        }
        return factory.control(user.participant(), f.action(), f.machineId(), f.sensorId(), user.username(), user.bpn());
    }

    @GetMapping("/reed/factory/briefing")
    public FactoryService.Briefing briefing(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String participant) {
        return factory.briefing(resolve(jwt, participant), CurrentUser.of(jwt).bpn());
    }

    /** Live readings, status changes and observations (server-sent events). */
    @GetMapping(path = "/reed/factory/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String participant,
                             HttpServletResponse response) {
        response.setHeader("X-Accel-Buffering", "no");  // nginx in front of the backend must not buffer the stream
        var line = resolve(jwt, participant);
        return factory.subscribe(line, own(jwt, line));
    }

    /** One of the company's own people (not the operator looking in). */
    private static boolean own(Jwt jwt, String line) {
        return line.equals(CurrentUser.of(jwt).participant());
    }

    private String resolve(Jwt jwt, String requested) {
        var user = CurrentUser.of(jwt);
        String participant;
        if (user.canImpersonateView()) {
            participant = requested != null ? requested : factory.lineNames().stream().findFirst().orElse(null);
        } else {
            participant = user.participant();
        }
        if (!factory.hasLine(participant)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no shop-floor line for your organisation");
        }
        return participant;
    }
}
