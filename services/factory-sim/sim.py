"""
Simulated shop-floor sensors for one company's demo line (the "toy factory").

Reads the company's machines and sensors from deployment/roster.json ("factory") and publishes over MQTT:
  reed/factory/<company>/<machine>/<sensor>          {"ts": <epoch ms>, "value": <float>}       every INTERVAL s
  reed/factory/<company>/<machine>/<sensor>/history  {"points": [[ts, value], ...]}              1-min backfill

A reading is a function of time plus noise (nominal + daily swing + a wear ramp that resets every cycle,
e.g. refractory wear until relining), so the backfilled history and the live stream form one curve.
On start it backfills from its last published time (7 days on first start), so the history has no gaps.
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


def value(spec: dict, t: float, rng: random.Random) -> float:
    daily = spec.get("dailyAmp", 0) * math.sin(2 * math.pi * (t % DAY) / DAY)
    return round(spec["nominal"] + daily + wear(spec, t) + rng.gauss(0, spec.get("noise", 0)), 4)


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

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"factory-sim-{company}")
    client.username_pw_set(company, os.environ["MQTT_PASSWORD"])
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
            client.publish(topic, json.dumps({"ts": int(t * 1000), "value": value(s, t, rng)}), qos=1)
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
    print("self-check ok")


if __name__ == "__main__":
    self_check() if "--self-check" in sys.argv else main()
