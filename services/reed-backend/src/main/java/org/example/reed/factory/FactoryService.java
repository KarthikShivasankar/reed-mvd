/*
 * Copyright (c) 2026 REED
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

package org.example.reed.factory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.example.reed.assistant.AssistantService;
import org.example.reed.assistant.LlmClient;
import org.example.reed.assistant.PersonalDataRedactor;
import org.example.reed.config.ReedProperties;
import org.example.reed.domain.AuditEvent;
import org.example.reed.domain.EventType;
import org.example.reed.domain.Observation;
import org.example.reed.factory.TrendAnalyzer.Insight;
import org.example.reed.factory.TrendAnalyzer.Point;
import org.example.reed.factory.TrendAnalyzer.Status;
import org.example.reed.participant.Roster;
import org.example.reed.repo.AuditEventRepository;
import org.example.reed.repo.ObservationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * The shop floor: companies' devices publish sensor readings over MQTT
 * ({@code reed/factory/<company>/<machine>/<sensor>}, backfills on {@code .../history}); the broker's ACL lets
 * a device publish only under its own company. REED stores the readings (Postgres), analyses every sensor
 * each minute ({@link TrendAnalyzer}), publishes status changes on {@code reed/factory/<company>/alerts} and
 * operators' observations on {@code reed/factory/<company>/observations}, and streams all of it to the
 * company's own dashboard users (server-sent events). A company's line is visible to its own users and the
 * dataspace operator only.
 */
@Service
public class FactoryService implements MqttCallback {

    private static final Logger LOG = LoggerFactory.getLogger(FactoryService.class);
    private static final Duration HISTORY_LIMIT = Duration.ofDays(8);
    /** range -> [window, bucket] for charts */
    private static final Map<String, String[]> RANGES = Map.of(
            "1h", new String[]{"1 hour", "30 seconds"},
            "24h", new String[]{"24 hours", "10 minutes"},
            "7d", new String[]{"7 days", "1 hour"});
    private static final String TAGGER_SYSTEM = """
            You tag shop-floor observations written by operators in a European manufacturing plant.
            Work only with machine and process data; never repeat personal data. Reply with the JSON object only.""";
    private static final String BRIEFING_SYSTEM = """
            You brief a production supervisor at the start of a shift. Work only with the provided JSON (sensor findings \
            and operators' observations). Quote numbers exactly as given; never invent or recompute numbers. \
            Be concrete and short. Reply with the JSON object only.""";

    public record SensorView(String key, String id, String name, String unit, Double lo, Double hi, Long ts, Double value,
                             Status status) {
    }

    public record MachineView(String id, String name, List<SensorView> sensors) {
    }

    public record LineView(String participant, String name, boolean brokerConnected, List<MachineView> machines) {
    }

    public record SeriesPoint(long t, double avg, double min, double max) {
    }

    public record Briefing(String headline, List<String> actions, String source, String model) {
    }

    /**
     * An observation as one viewer may see it: the company's own people get the original text and author;
     * viewers outside the company (the dataspace operator) get machine, category, severity and the one-line summary
     * (as published on MQTT) - no free text, which may name colleagues the redactor does not know - and no author.
     */
    public record ObservationView(Long id, String participant, String machineId, String category, String severity,
                                  String text, String summary, String source, String author, Instant createdAt) {
        static ObservationView of(Observation o, boolean own) {
            return new ObservationView(o.id, o.participant, o.machineId, o.category, o.severity,
                    own ? o.text : null, o.summary, o.source, own ? o.author : null, o.createdAt);
        }
    }

    private record Sensor(String participant, Roster.MachineSpec machine, Roster.SensorSpec spec) {
    }

    /** A live dashboard; {@code own}: a person of the company (else the operator, who gets redacted data). */
    private record Listener(SseEmitter emitter, boolean own) {
    }

    private final JdbcTemplate jdbc;
    private final ObservationRepository observations;
    private final AuditEventRepository audit;
    private final LlmClient llm;
    private final ObjectMapper mapper;
    private final boolean enabled;
    private final String url;
    private final String username;
    private final String password;
    private final int retentionDays;

    /** connector name -> line, in roster order */
    private final Map<String, Roster.FactorySpec> lines = new LinkedHashMap<>();
    /** connector/machine/sensor -> spec */
    private final Map<String, Sensor> sensors = new LinkedHashMap<>();
    private final Map<String, Point> latest = new ConcurrentHashMap<>();
    private final Map<String, Insight> insights = new ConcurrentHashMap<>();
    private final Map<String, Set<Listener>> listeners = new ConcurrentHashMap<>();
    private volatile MqttClient client;

    public FactoryService(JdbcTemplate jdbc, ObservationRepository observations, AuditEventRepository audit, LlmClient llm,
                          ObjectMapper mapper, ReedProperties props,
                          @Value("${reed.mqtt.enabled}") boolean enabled,
                          @Value("${reed.mqtt.url}") String url,
                          @Value("${reed.mqtt.username}") String username,
                          @Value("${reed.mqtt.password}") String password,
                          @Value("${reed.factory.retention-days}") int retentionDays) {
        this.jdbc = jdbc;
        this.observations = observations;
        this.audit = audit;
        this.llm = llm;
        this.mapper = mapper;
        this.enabled = enabled;
        this.url = url;
        this.username = username;
        this.password = password;
        this.retentionDays = retentionDays;
        try {
            for (var p : Roster.load(mapper, Path.of(props.getDeploymentDir(), "roster.json")).participants()) {
                if (p.factory() != null && p.connector() != null) {
                    var name = p.connector().name();
                    lines.put(name, p.factory());
                    for (var m : p.factory().machines()) {
                        for (var s : m.sensors()) {
                            sensors.put(name + "/" + m.id() + "/" + s.id(), new Sensor(name, m, s));
                        }
                    }
                }
            }
        } catch (Exception e) {
            LOG.warn("no shop-floor lines: roster not readable ({})", e.getMessage());
        }
    }

    // ---------------------------------------------------------------- MQTT

    /**
     * Connects before the backend reports healthy: devices start after that (docker compose), and the persistent
     * session (QoS 1, clean session off) makes the broker queue readings - including a device's history
     * backfill - whenever REED is down.
     */
    @PostConstruct
    void start() {
        if (!enabled || lines.isEmpty()) {
            return;
        }
        for (int attempt = 1; attempt <= 10; attempt++) {
            try {
                var c = new MqttClient(url, "reed-backend", new MemoryPersistence());
                var o = new MqttConnectOptions();
                o.setUserName(username);
                o.setPassword(password.toCharArray());
                o.setCleanSession(false);
                o.setAutomaticReconnect(true);
                o.setMaxInflight(100);
                c.setCallback(this);
                c.connect(o);
                c.subscribe(new String[]{"reed/factory/+/+/+", "reed/factory/+/+/+/history"}, new int[]{1, 1});
                client = c;
                LOG.info("shop floor: subscribed to {} sensors on {} line(s) at {}", sensors.size(), lines.size(), url);
                return;
            } catch (Exception e) {
                LOG.warn("MQTT broker {} not reachable (attempt {}): {}", url, attempt, e.getMessage());
                sleep(3_000);
            }
        }
        LOG.error("shop floor: no MQTT broker at {} - live readings are off until restart", url);
    }

    @PreDestroy
    void stop() {
        try {
            if (client != null) {
                client.disconnect();
            }
        } catch (Exception ignored) {
            // shutting down
        }
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        // Never throw here: an exception would drop the MQTT connection.
        try {
            var parts = topic.split("/");
            if (parts.length < 5) {
                return;
            }
            var key = parts[2] + "/" + parts[3] + "/" + parts[4];
            if (!sensors.containsKey(key)) {
                return;
            }
            var json = mapper.readTree(new String(message.getPayload(), StandardCharsets.UTF_8));
            if (parts.length == 5) {
                var p = point(json.path("ts"), json.path("value"));
                if (p != null) {
                    store(key, List.of(p));
                    latest.merge(key, p, (a, b) -> b.ts() >= a.ts() ? b : a);
                    broadcast(parts[2], "reading", Map.of("key", key, "ts", p.ts(), "value", p.value()));
                }
            } else if (parts.length == 6 && parts[5].equals("history")) {
                var pts = new ArrayList<Point>();
                json.path("points").forEach(x -> {
                    var p = point(x.path(0), x.path(1));
                    if (p != null) {
                        pts.add(p);
                    }
                });
                store(key, pts);
            }
        } catch (Exception e) {
            LOG.warn("ignored MQTT message on {}: {}", topic, e.getMessage());
        }
    }

    @Override
    public void connectionLost(Throwable cause) {
        LOG.warn("MQTT connection lost ({}); reconnecting", cause.getMessage());
    }

    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
        // QoS 1 publish acknowledged
    }

    /** A reading with a finite value and a plausible time (not in the future, not older than the history window). */
    private static Point point(JsonNode ts, JsonNode value) {
        if (!ts.isNumber() || !value.isNumber() || !Double.isFinite(value.asDouble())) {
            return null;
        }
        long now = System.currentTimeMillis();
        long t = ts.asLong();
        return t > now + 60_000 || t < now - HISTORY_LIMIT.toMillis() ? null : new Point(t, value.asDouble());
    }

    private void store(String key, List<Point> pts) {
        jdbc.batchUpdate("INSERT INTO reed_sensor_reading (sensor_key, ts, value) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                pts, 500, (ps, p) -> {
                    ps.setString(1, key);
                    ps.setTimestamp(2, Timestamp.from(Instant.ofEpochMilli(p.ts())));
                    ps.setDouble(3, p.value());
                });
    }

    private void publish(String participant, String kind, Object body) {
        var c = client;
        if (c == null || !c.isConnected()) {
            return;
        }
        try {
            var m = new MqttMessage(mapper.writeValueAsBytes(body));
            m.setQos(1);
            c.publish("reed/factory/" + participant + "/" + kind, m);
        } catch (Exception e) {
            LOG.warn("MQTT publish to {} failed: {}", participant, e.getMessage());
        }
    }

    // ---------------------------------------------------------------- analysis

    /** Every minute: analyse every sensor; a changed status is an alert (MQTT + live dashboards). */
    @Scheduled(initialDelay = 20_000, fixedDelay = 60_000)
    void analyseAll() {
        for (var key : sensors.keySet()) {
            try {
                var now = analyse(key);
                var before = insights.put(key, now);
                if (before == null ? now.status() != Status.OK : before.status() != now.status()) {
                    var participant = sensors.get(key).participant();
                    publish(participant, "alerts", Map.of("sensorKey", key, "status", now.status(), "finding", now.finding(),
                            "action", now.action() == null ? "" : now.action(), "at", Instant.now().toString()));
                    broadcast(participant, "insight", now);
                }
            } catch (Exception e) {
                LOG.warn("analysis of {} failed: {}", key, e.getMessage());
            }
        }
    }

    private Insight analyse(String key) {
        var s = sensors.get(key);
        var recent = jdbc.query("""
                SELECT extract(epoch FROM date_bin('1 minute', ts, TIMESTAMPTZ '2000-01-01Z')) * 1000 AS t, avg(value) AS v
                FROM reed_sensor_reading WHERE sensor_key = ? AND ts > now() - interval '2 hours'
                GROUP BY 1 ORDER BY 1""", (rs, i) -> new Point(rs.getLong("t"), rs.getDouble("v")), key);
        var base = jdbc.queryForObject("""
                SELECT avg(value) AS m, coalesce(stddev_samp(value), 0) AS sd, count(*) AS n FROM reed_sensor_reading
                WHERE sensor_key = ? AND ts > now() - interval '7 days' AND ts <= now() - interval '2 hours'""",
                (rs, i) -> new TrendAnalyzer.Baseline(rs.getDouble("m"), rs.getDouble("sd"), rs.getLong("n")), key);
        return TrendAnalyzer.analyse(key, s.machine(), s.spec(), recent, base);
    }

    @Scheduled(cron = "0 17 3 * * *")
    void applyRetention() {
        int n = jdbc.update("DELETE FROM reed_sensor_reading WHERE ts < now() - make_interval(days => ?)", retentionDays);
        LOG.info("shop floor: deleted {} reading(s) older than {} days", n, retentionDays);
    }

    // ---------------------------------------------------------------- queries

    public boolean hasLine(String participant) {
        return participant != null && lines.containsKey(participant);
    }

    public Collection<String> lineNames() {
        return lines.keySet();
    }

    public LineView line(String participant) {
        var spec = lines.get(participant);
        var machines = new ArrayList<MachineView>();
        for (var m : spec.machines()) {
            var views = new ArrayList<SensorView>();
            for (var s : m.sensors()) {
                var key = participant + "/" + m.id() + "/" + s.id();
                var p = latest.get(key);
                var i = insights.get(key);
                views.add(new SensorView(key, s.id(), s.name(), s.unit(), s.lo(), s.hi(), p == null ? null : p.ts(),
                        p == null ? null : p.value(), i == null ? null : i.status()));
            }
            machines.add(new MachineView(m.id(), m.name(), views));
        }
        var c = client;
        return new LineView(participant, spec.name(), c != null && c.isConnected(), machines);
    }

    public List<SeriesPoint> series(String participant, String key, String range) {
        if (!key.startsWith(participant + "/") || !sensors.containsKey(key)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown sensor " + key);
        }
        var r = RANGES.get(range);
        if (r == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "range must be one of " + RANGES.keySet());
        }
        return jdbc.query("""
                SELECT extract(epoch FROM date_bin(CAST(? AS interval), ts, TIMESTAMPTZ '2000-01-01Z')) * 1000 AS t,
                       avg(value) AS a, min(value) AS lo, max(value) AS hi
                FROM reed_sensor_reading WHERE sensor_key = ? AND ts > now() - CAST(? AS interval)
                GROUP BY 1 ORDER BY 1""",
                (rs, i) -> new SeriesPoint(rs.getLong("t"), rs.getDouble("a"), rs.getDouble("lo"), rs.getDouble("hi")),
                r[1], key, r[0]);
    }

    /** Current findings for the line, most urgent first (analysed now if the minute's run has not happened yet). */
    public List<Insight> insights(String participant) {
        var out = new ArrayList<Insight>();
        for (var e : sensors.entrySet()) {
            if (e.getValue().participant().equals(participant)) {
                out.add(insights.computeIfAbsent(e.getKey(), this::analyse));
            }
        }
        out.sort(Comparator.comparing((Insight i) -> i.status().ordinal()).reversed()
                .thenComparing(i -> i.hoursToLimit() == null ? Double.MAX_VALUE : i.hoursToLimit()));
        return out;
    }

    /**
     * The line's state right now, as a data product: per machine its worst status and what is not OK. Released to
     * partners only inside the company's ProductionStatus payload, i.e. under an EDC contract (see the usage decision).
     */
    public Map<String, Object> summary(String participant) {
        var all = insights(participant);
        var machines = new ArrayList<Map<String, Object>>();
        for (var m : lines.get(participant).machines()) {
            var mine = all.stream().filter(i -> i.machineId().equals(m.id())).toList();
            var worst = mine.stream().map(Insight::status).max(Comparator.naturalOrder()).orElse(Status.OK);
            machines.add(Map.of("machine", m.name(), "status", worst,
                    "findings", mine.stream().filter(i -> i.status() != Status.OK).map(Insight::finding).toList()));
        }
        var out = new LinkedHashMap<String, Object>();
        out.put("line", lines.get(participant).name());
        out.put("at", Instant.now().toString());
        out.put("alarms", all.stream().filter(i -> i.status() == Status.ALARM).count());
        out.put("warnings", all.stream().filter(i -> i.status() == Status.WARNING).count());
        out.put("machines", machines);
        return out;
    }

    public List<ObservationView> observations(String participant, boolean own) {
        return observations.findTop100ByParticipantOrderByCreatedAtDesc(participant).stream()
                .map(o -> ObservationView.of(o, own)).toList();
    }

    // ---------------------------------------------------------------- operators' observations

    /**
     * Stores an operator's plain-language observation, tagged (machine, category, severity, one-line summary)
     * by the local LLM - which only sees the text with personal data removed - or by rules. Published over MQTT
     * and to live dashboards without the author.
     */
    public ObservationView observe(String participant, String text, String machineId, String author, String actorBpn,
                               Collection<String> personNames) {
        if (text == null || text.isBlank() || text.length() > 2000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "an observation needs 1-2000 characters of text");
        }
        var machines = lines.get(participant).machines();
        var ids = machines.stream().map(Roster.MachineSpec::id).toList();
        if (machineId != null && !machineId.isBlank() && !ids.contains(machineId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown machine " + machineId);
        }
        var redacted = PersonalDataRedactor.redact(text, personNames);
        var tag = ObservationTagger.tag(redacted.text(), machines);
        var source = "rules";

        var choices = new ArrayList<>(ids);
        choices.add("none");
        var schema = Map.<String, Object>of("type", "object", "additionalProperties", false,
                "required", List.of("machineId", "category", "severity", "summary"),
                "properties", Map.of(
                        "machineId", Map.of("type", "string", "enum", choices),
                        "category", Map.of("type", "string", "enum", ObservationTagger.CATEGORIES),
                        "severity", Map.of("type", "string", "enum", ObservationTagger.SEVERITIES),
                        "summary", Map.of("type", "string")));
        var machineList = new StringBuilder();
        machines.forEach(m -> machineList.append("- ").append(m.id()).append(": ").append(m.name()).append('\n'));
        var messages = List.<Map<String, Object>>of(
                Map.of("role", "system", "content", TAGGER_SYSTEM),
                Map.of("role", "user", "content", "Machines on this line:\n" + machineList + """

                        Tag this observation: the machine it is about ("none" if unclear), category (safety, quality, \
                        maintenance or process), severity (high = stop or danger, medium = needs attention this shift, \
                        low = for information) and a one-line summary of at most 20 words.

                        Observation: """ + redacted.text()));
        // Free shop-floor text can name colleagues the redactor does not know: only a local model tags it.
        var out = llm.local() ? llm.chat(messages, null, schema).flatMap(llm::json) : Optional.<JsonNode>empty();
        if (out.isPresent()) {
            var j = out.get();
            var m = j.path("machineId").asText();
            var cat = j.path("category").asText();
            var sev = j.path("severity").asText();
            var sum = j.path("summary").asText("").strip();
            if ((m.equals("none") || ids.contains(m)) && ObservationTagger.CATEGORIES.contains(cat)
                    && ObservationTagger.SEVERITIES.contains(sev)) {
                var summary = !sum.isEmpty() && sum.length() <= 300 && AssistantService.numbersGrounded(sum, redacted.text())
                        ? sum : tag.summary();
                // The model may raise urgency, never lower it below the rules: smoke, fire, leaks stay high.
                tag = new ObservationTagger.Tag(m.equals("none") ? null : m, cat,
                        "high".equals(tag.severity()) ? "high" : sev, summary);
                source = "llm";
            }
        }
        if (machineId != null && !machineId.isBlank()) {
            tag = new ObservationTagger.Tag(machineId, tag.category(), tag.severity(), tag.summary());  // the operator's choice wins
        }
        var o = observations.save(new Observation(participant, tag.machineId(), tag.category(), tag.severity(), text,
                tag.summary(), source, author));
        audit.save(new AuditEvent(EventType.ASSIST, actorBpn, null, "observation " + o.id + " on " + participant + " tagged via "
                + source + ("llm".equals(source) ? " (" + llm.model() + ")" : "") + ", " + redacted.redactions() + " redaction(s)"));
        publish(participant, "observations", Map.of("id", o.id, "machineId", o.machineId == null ? "" : o.machineId,
                "category", o.category, "severity", o.severity, "summary", o.summary, "at", o.createdAt.toString()));
        broadcast(participant, "observation", own -> ObservationView.of(o, own));
        return ObservationView.of(o, true);
    }

    // ---------------------------------------------------------------- line controls (toy factory)

    /**
     * A command to the company's own line, sent over MQTT on {@code reed/factory/<company>/control} (the ACL lets
     * only that company's devices read it): inject a fault ({@code drift}: past the limit in about 5 minutes,
     * {@code spike}: past it at once) or maintain a machine (faults cleared, wear reset). The effect comes back
     * as readings, so the same analysis, alerts and briefing apply as on a real line.
     */
    public Map<String, Object> control(String participant, String action, String machineId, String sensorId,
                                       String actor, String actorBpn) {
        var line = lines.get(participant);
        var machine = line.machines().stream().filter(m -> m.id().equals(machineId)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown machine " + machineId));
        var cmd = new LinkedHashMap<String, Object>();
        switch (action == null ? "" : action) {
            case "drift", "spike" -> {
                var sensor = machine.sensors().stream().filter(x -> x.id().equals(sensorId)).findFirst()
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown sensor " + sensorId));
                cmd.put("cmd", "fault");
                cmd.put("machine", machine.id());
                cmd.put("sensor", sensor.id());
                cmd.put("kind", action);
            }
            case "maintain" -> {
                cmd.put("cmd", "maintain");
                cmd.put("machine", machine.id());
            }
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "action must be drift, spike or maintain");
        }
        var c = client;
        if (c == null || !c.isConnected()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "the shop-floor broker is not connected");
        }
        publish(participant, "control", cmd);
        var what = "maintain".equals(action) ? "maintenance on " + machine.name()
                : action + " fault on " + machine.name() + " / " + sensorId;
        audit.save(new AuditEvent(EventType.ASSIST, actorBpn, null, actor + " sent " + what + " to the " + participant + " line"));
        var event = Map.<String, Object>of("action", action, "machineId", machine.id(), "sensorId", sensorId == null ? "" : sensorId,
                "what", what, "at", Instant.now().toString());
        broadcast(participant, "control", event);
        return event;
    }

    // ---------------------------------------------------------------- shift briefing

    /** Decision guidance for the shift: the LLM's briefing if every number in it is grounded, else a template. */
    public Briefing briefing(String participant, String actorBpn) {
        var findings = insights(participant).stream().filter(i -> i.status() != Status.OK).toList();
        var recent = observations.findByParticipantAndCreatedAtAfterOrderByCreatedAtDesc(participant,
                Instant.now().minus(Duration.ofHours(24)));
        var input = mapper.createObjectNode();
        input.put("line", lines.get(participant).name());
        var fa = input.putArray("sensorFindings");
        findings.forEach(i -> fa.addObject().put("machine", i.machine()).put("status", i.status().name())
                .put("finding", i.finding()).put("action", i.action()));
        var oa = input.putArray("operatorObservations");
        recent.stream().limit(20).forEach(o -> oa.addObject().put("machine", machineName(participant, o.machineId))
                .put("category", o.category).put("severity", o.severity).put("summary", o.summary));  // summaries are redacted
        var inputText = input.toString();

        var schema = Map.<String, Object>of("type", "object", "additionalProperties", false,
                "required", List.of("headline", "actions"),
                "properties", Map.of("headline", Map.of("type", "string"),
                        "actions", Map.of("type", "array", "items", Map.of("type", "string"))));
        var messages = List.<Map<String, Object>>of(
                Map.of("role", "system", "content", BRIEFING_SYSTEM),
                Map.of("role", "user", "content", """
                        Write the shift briefing: a one-sentence headline on the state of the line, then up to 6 actions, \
                        most urgent first. Connect sensor findings with operators' observations on the same machine \
                        where they agree.

                        """ + inputText));
        var out = llm.chat(messages, null, schema).flatMap(llm::json)
                .filter(j -> AssistantService.numbersGrounded(j.toString(), inputText));
        audit.save(new AuditEvent(EventType.ASSIST, actorBpn, null, "shift briefing for " + participant + " via "
                + (out.isPresent() ? "llm" : "rules")));
        if (out.isPresent()) {
            var actions = new ArrayList<String>();
            out.get().path("actions").forEach(a -> actions.add(a.asText()));
            return new Briefing(out.get().path("headline").asText(), actions.stream().limit(6).toList(), "llm", llm.model());
        }
        return templateBriefing(participant, findings, recent);
    }

    private Briefing templateBriefing(String participant, List<Insight> findings, List<Observation> recent) {
        long alarms = findings.stream().filter(i -> i.status() == Status.ALARM).count();
        long warnings = findings.stream().filter(i -> i.status() == Status.WARNING).count();
        long watch = findings.stream().filter(i -> i.status() == Status.WATCH).count();
        var name = lines.get(participant).name();
        var headline = findings.isEmpty()
                ? "All sensors on " + name + " are steady."
                : name + ": " + alarms + " alarm(s), " + warnings + " warning(s), " + watch + " to watch.";
        var actions = new ArrayList<String>();
        findings.stream().filter(i -> i.status().compareTo(Status.WARNING) >= 0)
                .forEach(i -> actions.add(i.machine() + ": " + i.action() + " - " + i.finding()));
        recent.stream().filter(o -> "high".equals(o.severity))
                .forEach(o -> actions.add("Follow up the operator report on " + machineName(participant, o.machineId) + ": " + o.summary));
        return new Briefing(headline, actions.stream().limit(6).toList(), "rules", null);
    }

    private String machineName(String participant, String machineId) {
        return lines.get(participant).machines().stream().filter(m -> m.id().equals(machineId))
                .map(Roster.MachineSpec::name).findFirst().orElse("the line");
    }

    // ---------------------------------------------------------------- live stream

    public SseEmitter subscribe(String participant, boolean own) {
        var emitter = new SseEmitter(Duration.ofMinutes(30).toMillis());
        var set = listeners.computeIfAbsent(participant, k -> new CopyOnWriteArraySet<>());
        var l = new Listener(emitter, own);
        set.add(l);
        emitter.onCompletion(() -> set.remove(l));
        emitter.onTimeout(() -> set.remove(l));
        emitter.onError(e -> set.remove(l));
        try {
            emitter.send(SseEmitter.event().name("hello").data(Map.of("participant", participant)));
        } catch (Exception e) {
            set.remove(l);
        }
        return emitter;
    }

    private void broadcast(String participant, String event, Object data) {
        broadcast(participant, event, own -> data);
    }

    /** {@code data}: what a listener gets, by whether it is one of the company's own people. */
    private void broadcast(String participant, String event, java.util.function.Function<Boolean, Object> data) {
        var set = listeners.get(participant);
        if (set == null) {
            return;
        }
        for (var l : set) {
            try {
                l.emitter().send(SseEmitter.event().name(event).data(data.apply(l.own())));
            } catch (Exception ex) {
                set.remove(l);
            }
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
