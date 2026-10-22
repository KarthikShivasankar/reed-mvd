#!/usr/bin/env bash
#
# End-to-end check of the shop floor (sensors over MQTT -> REED -> dashboards), with real broker credentials:
#
#   1. the broker refuses a wrong password, and a company's device cannot publish as another company
#   2. a device reading travels MQTT -> REED -> the company's live stream (and only that company's)
#   3. the simulated devices' 7-day history is stored; every sensor is analysed
#   4. an operator observation is tagged and published on MQTT without the author or personal data
#   5. a shift briefing is produced
#   6. who sees what: own line only; the operator reads any line (operators' notes redacted, no author) but cannot
#      report or steer it; no token, no data
#   7. the toy factory in real time: a company injects a fault from REED -> its devices (MQTT control topic) ->
#      readings -> ALARM + MQTT alert; maintenance brings the machine back
#
# Usage: ./run-factory.sh   (stack up). Exit code 0 = all PASS.
set -euo pipefail
LOG_TAG=factory
source "$(dirname "$0")/tools/reed-lib.sh"
UI="${REED_UI:-http://127.0.0.1:8088}"   # the dashboard origin proxies /reed (the live stream goes through nginx)
TMP=$(mktemp -d); trap 'rm -rf "$TMP" "$STATUS_FILE"' EXIT

mqtt_sub() { docker exec reed-mosquitto mosquitto_sub -u reed-backend -P "$MQTT_PASSWORD_REED_BACKEND" "$@"; }
mqtt_pub() { local user=$1 pw=$2; shift 2; docker exec reed-mosquitto mosquitto_pub -u "$user" -P "$pw" "$@"; }

C=$(token castellum-engineer); W=$(token wisla-engineer); N=$(token nordvind-buyer); A=$(token reed-admin)

log "1. broker authentication and per-company topics"
mqtt_pub castellum wrong -t reed/factory/castellum/x/y -m 1 2>/dev/null && fail "wrong password accepted" || pass "wrong password refused"
(mqtt_sub -t reed/factory/wisla/spoof/x -C 1 -W 5 >"$TMP/spoof" 2>/dev/null || true) &
sleep 1; mqtt_pub castellum "$MQTT_PASSWORD_CASTELLUM" -t reed/factory/wisla/spoof/x -m '{"ts":1,"value":1}'; wait
[[ ! -s $TMP/spoof ]] && pass "castellum's device cannot publish under wisla" || fail "spoofed reading delivered: $(cat "$TMP/spoof")"
(mqtt_sub -t reed/factory/castellum/alerts -C 1 -W 5 >"$TMP/fake" 2>/dev/null || true) &
sleep 1; mqtt_pub castellum "$MQTT_PASSWORD_CASTELLUM" -t reed/factory/castellum/alerts -m '{"status":"OK","finding":"all fine"}'; wait
[[ ! -s $TMP/fake ]] && pass "a device cannot publish alerts (only REED can)" || fail "fake alert delivered: $(cat "$TMP/fake")"

log "2. a device reading reaches the company's live stream (MQTT -> REED -> server-sent events via nginx)"
timeout 12 curl -sN "$UI/reed/factory/stream" -H "Authorization: Bearer $C" >"$TMP/castellum.sse" 2>/dev/null &
timeout 12 curl -sN "$UI/reed/factory/stream" -H "Authorization: Bearer $W" >"$TMP/wisla.sse" 2>/dev/null &
sleep 2
mqtt_pub castellum "$MQTT_PASSWORD_CASTELLUM" -q 1 -t reed/factory/castellum/moulding-1/cycle-time \
  -m "{\"ts\": $(date +%s%3N), \"value\": 49.4242}"
wait || true
grep -q '"value":49.4242' "$TMP/castellum.sse" && pass "reading pushed live to castellum" || fail "reading not on castellum's stream"
! grep -q 'castellum/' "$TMP/wisla.sse" && grep -q 'wisla/' "$TMP/wisla.sse" \
  && pass "wisla's stream carries only wisla's sensors" || fail "wisla's stream: $(head -c 300 "$TMP/wisla.sse")"

log "3. history and analysis"
N7=$(api "$C" GET "/reed/factory/series?key=castellum/furnace-1/shell-temp&range=7d" | jq length)
(( N7 >= 150 )) && pass "7 days of hourly history ($N7 points)" || fail "history: only $N7 points"
INS=$(api "$C" GET /reed/factory/insights)
jq -e 'length == 6 and all(.[]; .status | IN("OK","WATCH","WARNING","ALARM"))' <<<"$INS" >/dev/null \
  && pass "all 6 castellum sensors analysed: $(jq -c '[.[] | .status] | group_by(.) | map({(.[0]): length}) | add' <<<"$INS")" \
  || fail "insights: $INS"

log "4. an operator observation: tagged, published on MQTT without author or personal data"
(mqtt_sub -t reed/factory/castellum/observations -C 1 -W 150 >"$TMP/obs.mqtt" 2>/dev/null || true) &
sleep 1
OBS=$(api "$C" POST /reed/factory/observations \
  '{"text":"Smoke from under induction furnace 1, area cleared. Call me on +34 612 345 678."}')
wait
jq -e '.machineId == "furnace-1" and .severity == "high" and .category == "safety"' <<<"$OBS" >/dev/null \
  && pass "tagged furnace-1 / safety / high (via $(jq -r .source <<<"$OBS"))" || fail "tagging: $OBS"
grep -q '"summary"' "$TMP/obs.mqtt" && pass "published on reed/factory/castellum/observations" || fail "not on MQTT"
! grep -qE '612 345 678|castellum-engineer|"author"' "$TMP/obs.mqtt" \
  && pass "MQTT message has no phone number and no author" || fail "personal data on MQTT: $(cat "$TMP/obs.mqtt")"
! jq -r .summary <<<"$OBS" | grep -q '612' && pass "summary has no phone number" || fail "summary: $(jq -r .summary <<<"$OBS")"

log "5. shift briefing"
BR=$(api "$C" GET /reed/factory/briefing)
jq -e '(.headline | length > 0) and (.actions | type == "array")' <<<"$BR" >/dev/null \
  && pass "briefing via $(jq -r .source <<<"$BR"): $(jq -r .headline <<<"$BR")" || fail "briefing: $BR"

log "6. who sees what"
api "$W" GET "/reed/factory?participant=castellum" >"$TMP/w"
[[ $(jq -r .participant "$TMP/w") == wisla ]] && pass "wisla asking for castellum gets its own line" || fail "wisla got $(head -c 200 "$TMP/w")"
api "$W" GET "/reed/factory/series?key=castellum/furnace-1/melt-temp" >/dev/null
[[ $(status) == 404 ]] && pass "wisla cannot read castellum's sensors" || fail "wisla read castellum's sensor: $(status)"
api "$N" GET /reed/factory >/dev/null
[[ $(status) == 404 ]] && pass "nordvind (no line) gets 404" || fail "nordvind: $(status)"
api "$A" GET "/reed/factory?participant=wisla" >"$TMP/a"
[[ $(jq -r .participant "$TMP/a") == wisla ]] && pass "the operator reads wisla's line" || fail "operator: $(head -c 200 "$TMP/a")"
api "$A" POST /reed/factory/observations '{"text":"x"}' >/dev/null
[[ $(status) == 403 ]] && pass "the operator cannot report on a company's line" || fail "operator posted: $(status)"
api "$A" GET "/reed/factory/observations?participant=castellum" >"$TMP/ao"
jq -e 'length > 0 and all(.[]; .author == null) and (map(.text) | join(" ") | test("612") | not)' "$TMP/ao" >/dev/null \
  && pass "the operator sees operators' notes redacted and without author" || fail "operator sees: $(head -c 300 "$TMP/ao")"
api "$C" GET /reed/factory/observations | jq -e '.[0].author == "castellum-engineer"' >/dev/null \
  && pass "the company itself sees its notes in full" || fail "castellum's own view lacks the author"
api "$A" POST /reed/factory/control '{"action":"maintain","machineId":"furnace-1"}' >/dev/null
[[ $(status) == 403 ]] && pass "the operator cannot steer a company's line" || fail "operator steered: $(status)"
[[ $(curl -s -o /dev/null -w '%{http_code}' "$UI/reed/factory") == 401 ]] && pass "no token: 401" || fail "anonymous access"

log "7. toy factory in real time: fault -> ALARM + MQTT alert -> maintenance -> back to normal"
SENSOR=castellum/fettling-1/spindle-vibration
state_of() { api "$C" GET /reed/factory/insights | jq -r --arg k "$SENSOR" '.[] | select(.sensorKey==$k) | .status'; }
api "$C" POST /reed/factory/control '{"action":"bogus","machineId":"fettling-1"}' >/dev/null
[[ $(status) == 400 ]] && pass "unknown command refused" || fail "bogus command: $(status)"
(mqtt_sub -t reed/factory/castellum/alerts -C 1 -W 200 >"$TMP/alert" 2>/dev/null || true) &
sleep 1
api "$C" POST /reed/factory/control '{"action":"spike","machineId":"fettling-1","sensorId":"spindle-vibration"}' | jq -r .what
st=""; for _ in $(seq 1 40); do st=$(state_of); [[ $st == ALARM ]] && break; sleep 5; done
[[ $st == ALARM ]] && pass "spike fault -> $SENSOR in ALARM: $(api "$C" GET /reed/factory/insights | jq -r --arg k "$SENSOR" '.[] | select(.sensorKey==$k) | .finding')" \
  || fail "no ALARM after the fault (status $st)"
wait
grep -q "$SENSOR" "$TMP/alert" && pass "alert published on reed/factory/castellum/alerts" || fail "no MQTT alert: $(cat "$TMP/alert")"
api "$C" POST /reed/factory/control '{"action":"maintain","machineId":"fettling-1"}' | jq -r .what
for _ in $(seq 1 48); do st=$(state_of); [[ $st != ALARM ]] && break; sleep 5; done
[[ $st != ALARM ]] && pass "after maintenance $SENSOR is $st again" || fail "still ALARM after maintenance"

log "done"
exit $FAILED
