"""
Simulated shop-floor sensors for one company's demo line (the "toy factory").

Reads the company's machines and sensors from deployment/roster.json ("factory") and publishes over MQTT:
  reed/factory/<company>/<machine>/<sensor>          {"ts": <epoch ms>, "value": <float>}       every INTERVAL s
  reed/factory/<company>/<machine>/<sensor>/history  {"points": [[ts, value], ...]}              1-min backfill

A reading is a function of time plus noise (nominal + daily swing + a wear ramp that resets every cycle,
e.g. refractory wear until relining), so the backfilled history and the live stream form one curve.
On start it backfills from its last published time (7 days on first start), so the history has no gaps.

The line takes commands from REED on reed/factory/<company>/control (sent from the dashboard):
  {"cmd": "fault", "machine": m, "sensor": s, "kind": "drift" | "spike"}  drift past the limit in ~5 min / jump past it
  {"cmd": "maintain", "machine": m}                                      clear the machine's faults, reset its wear
Commands live in memory: a restart brings the line back to its normal curve.
"""

import json
import math
import os
import random
import sys
import time
from pathlib import Path

DAY = 86400
BACKFILL_DAYS = 7
CHUNK = 360  # history points per message (6 h at 1 min)


def wear(spec: dict, t: float) -> float:
    """Ramp over the last 60 % of each cycle, then reset (maintenance). Each cycle wears a bit differently,
    so some cycles end beyond the sensor's limit (an alarm) and others just short of it."""
    rate, cycle = spec.get("driftPerHour"), spec.get("cycleHours")
    if not rate or not cycle:
        return 0.0
    hours = t / 3600
    n, phase = divmod(hours, cycle)
    severity = random.Random(f'{spec["id"]}:{int(n)}').uniform(0.75, 1.3)
    return rate * severity * max(0.0, phase - 0.4 * cycle)


def value(spec: dict, t: float, rng: random.Random, fault: dict | None = None, worn: bool = True) -> float:
    daily = spec.get("dailyAmp", 0) * math.sin(2 * math.pi * (t % DAY) / DAY)
    return round(spec["nominal"] + daily + (wear(spec, t) if worn else 0) + offset(spec, fault, t)
                 + rng.gauss(0, spec.get("noise", 0)), 4)


DRIFT_SECONDS = 300  # a drift fault crosses the limit after about 5 minutes


def offset(spec: dict, fault: dict | None, t: float) -> float:
    """A fault pushes the sensor towards its nearest limit and 30 % beyond it (spike: at once; drift: linearly)."""
    if not fault:
        return 0.0
    if spec.get("hi") is not None:
        gap = spec["hi"] - spec["nominal"]
    elif spec.get("lo") is not None:
        gap = spec["lo"] - spec["nominal"]
    else:
        gap = 3 * spec.get("noise", 1) or 1
    full = 1.3 * gap
    if fault["kind"] == "spike":
        return full
    return full * min(1.0, (t - fault["since"]) / (DRIFT_SECONDS * 1.3))


class Line:
    """The commands REED sent: active faults per sensor topic and machines maintained this wear cycle."""

    def __init__(self, company: str, specs: list):
        self.company, self.specs = company, dict(specs)
        self.faults: dict[str, dict] = {}
        self.maintained: dict[str, float] = {}  # topic -> wear suppressed until (end of the current cycle)

    def command(self, msg: dict, now: float) -> str:
        machine = msg.get("machine", "")
        prefix = f"reed/factory/{self.company}/{machine}/"
        topics = [t for t in self.specs if t.startswith(prefix)]
        if not topics:
            return f"ignored: unknown machine {machine!r}"
        if msg.get("cmd") == "fault" and msg.get("kind") in ("drift", "spike"):
            topic = prefix + str(msg.get("sensor", ""))
            if topic not in self.specs:
                return f"ignored: unknown sensor {msg.get('sensor')!r}"
            self.faults[topic] = {"kind": msg["kind"], "since": now}
            return f"{msg['kind']} fault on {topic}"
        if msg.get("cmd") == "maintain":
            for t in topics:
                self.faults.pop(t, None)
                cycle = self.specs[t].get("cycleHours")
                if cycle:
                    self.maintained[t] = (now // (cycle * 3600) + 1) * cycle * 3600
            return f"maintenance on {machine}: faults cleared, wear reset"
        return f"ignored: {msg}"

    def reading(self, topic: str, t: float, rng: random.Random) -> float:
        return value(self.specs[topic], t, rng, self.faults.get(topic), worn=t >= self.maintained.get(topic, 0))


def sensors(roster: dict, company: str):
    for p in roster["participants"]:
        if (p.get("connector") or {}).get("name") == company and p.get("factory"):
            for m in p["factory"]["machines"]:
                for s in m["sensors"]:
                    yield f'reed/factory/{company}/{m["id"]}/{s["id"]}', s
            return
    sys.exit(f"no factory for {company} in the roster")


def main() -> None:
    import paho.mqtt.client as mqtt

    company = os.environ["COMPANY"]
    interval = float(os.environ.get("INTERVAL", "5"))
    state = Path(os.environ.get("STATE_DIR", "/state")) / "last-ts"
    specs = list(sensors(json.loads(Path(os.environ.get("ROSTER", "/app/roster.json")).read_text()), company))
    rng = random.Random()

    line = Line(company, specs)
    control = f"reed/factory/{company}/control"

    def on_connect(c, _userdata, _flags, _reason, _props):
        c.subscribe(control, qos=1)  # (re)subscribe on every connect

    def on_message(_c, _userdata, msg):
        try:
            print(f"[{company}] {line.command(json.loads(msg.payload), time.time())}", flush=True)
        except Exception as e:  # a bad command must not stop the line
            print(f"[{company}] bad command: {e}", flush=True)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"factory-sim-{company}")
    client.username_pw_set(company, os.environ["MQTT_PASSWORD"])
    client.on_connect, client.on_message = on_connect, on_message
    client.connect(os.environ.get("MQTT_HOST", "mosquitto"), int(os.environ.get("MQTT_PORT", "1883")))
    client.loop_start()

    now = time.time()
    since = float(state.read_text()) if state.exists() else now - BACKFILL_DAYS * DAY
    start = (int(since) // 60 + 1) * 60
    if now - start > 60:
        for topic, s in specs:
            points = [[t * 1000, value(s, t, rng)] for t in range(start, int(now), 60)]
            for i in range(0, len(points), CHUNK):
                client.publish(topic + "/history", json.dumps({"points": points[i:i + CHUNK]}), qos=1)
        print(f"[{company}] backfilled {len(specs)} sensors from {time.strftime('%Y-%m-%d %H:%M', time.gmtime(start))}Z", flush=True)

    print(f"[{company}] publishing {len(specs)} sensors every {interval:g} s", flush=True)
    last_saved = 0.0
    while True:
        t = time.time()
        for topic, s in specs:
            client.publish(topic, json.dumps({"ts": int(t * 1000), "value": line.reading(topic, t, rng)}), qos=1)
        if t - last_saved >= 60:
            state.write_text(str(t))
            last_saved = t
        time.sleep(interval)


def self_check() -> None:
    spec = {"id": "x", "nominal": 10, "noise": 0, "driftPerHour": 2, "cycleHours": 10}
    rng = random.Random(1)
    assert value(spec, 3 * 3600, rng) == 10                      # first 40 % of the cycle: no wear
    assert value(spec, 9 * 3600, rng) > value(spec, 6 * 3600, rng) > 10   # then it ramps
    assert value(spec, 10 * 3600 + 60, rng) == 10                # and resets with the next cycle
    assert value({"nominal": 5}, 0, rng) == 5                    # a plain sensor is its nominal value

    hot = {"id": "h", "nominal": 100, "hi": 140, "noise": 0}
    line = Line("acme", [("reed/factory/acme/m1/h", hot), ("reed/factory/acme/m1/w", spec)])
    assert line.command({"cmd": "fault", "machine": "m1", "sensor": "h", "kind": "spike"}, 0).startswith("spike")
    assert line.reading("reed/factory/acme/m1/h", 1, rng) == 152           # 30 % beyond the 140 limit at once
    line.command({"cmd": "fault", "machine": "m1", "sensor": "h", "kind": "drift"}, 0)
    assert 100 < line.reading("reed/factory/acme/m1/h", 150, rng) < 140      # half-way after 2.5 min
    assert line.reading("reed/factory/acme/m1/h", DRIFT_SECONDS + 1, rng) > 140  # past the limit after ~5 min
    assert line.command({"cmd": "maintain", "machine": "m1"}, 9 * 3600).startswith("maintenance")
    assert line.reading("reed/factory/acme/m1/h", 9 * 3600, rng) == 100      # fault cleared
    assert line.reading("reed/factory/acme/m1/w", 9 * 3600, rng) == 10       # wear reset for this cycle
    assert line.reading("reed/factory/acme/m1/w", 19 * 3600, rng) > 10      # and wears again in the next one
    assert line.command({"cmd": "maintain", "machine": "nope"}, 0).startswith("ignored")
    print("self-check ok")


if __name__ == "__main__":
    self_check() if "--self-check" in sys.argv else main()
