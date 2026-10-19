#!/usr/bin/env python3
"""REED data service: one per company, serving that company's confidential payloads.

Only the company's own EDC data plane can call it (with the company's data key, carried in the
asset data address). Before releasing a payload it asks REED for a usage decision - the consumer
(named by the data plane from the verified EDR) must hold a contract agreement for the asset, and
time-limited licences must not have expired - and fails closed if REED cannot be reached.

Every released payload carries a `_reedLicense` block: licensee, agreement, expiry, the duties of
the policy, and an HMAC watermark over payload + licence, so a leaked copy can be attributed to the
licensee it was issued to and checked against its terms.
"""
import hashlib
import hmac
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

KEY = os.environ["DATA_KEY"]
COMPANY = os.environ["COMPANY"]
USAGE_URL = os.environ.get("REED_USAGE_URL", "http://reed-backend:8080/reed/usage/decide")
DATA = Path(os.environ.get("DATA_DIR", "/data"))
CA = os.environ.get("TLS_CA")  # trust the REED CA for calls to the backend
ASSET = re.compile(r"[a-z0-9-]{1,120}")


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def watermark(payload: dict, licence: dict) -> str:
    return hmac.new(KEY.encode(), canonical({"payload": payload, "licence": licence}), hashlib.sha256).hexdigest()


def decide(asset_id: str, consumer: str | None) -> tuple[int, dict]:
    body = json.dumps({"assetId": asset_id, "consumerDid": consumer}).encode()
    req = urllib.request.Request(USAGE_URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "X-Api-Key": KEY, "X-Data-Service": COMPANY})
    ctx = ssl.create_default_context(cafile=CA) if CA else None
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except ValueError:
            return e.code, {"reason": e.reason}
    except OSError as e:  # fail closed: no decision, no data
        return 503, {"reason": f"usage decision unavailable: {e}"}


class Handler(BaseHTTPRequestHandler):
    server_version = "reed-data-service"

    def send(self, status: int, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/health":
            return self.send(200, {"status": "UP", "company": COMPANY})
        if not path.startswith("/submodels/") or not ASSET.fullmatch(path[len("/submodels/"):]):
            return self.send(404, {"reason": "not found"})
        asset_id = path[len("/submodels/"):]
        if not hmac.compare_digest(self.headers.get("X-Api-Key", ""), KEY):
            return self.send(401, {"reason": "missing or invalid X-Api-Key"})
        file = DATA / f"{asset_id}.json"
        if not file.is_file():
            return self.send(404, {"reason": "unknown asset"})
        status, decision = decide(asset_id, self.headers.get("X-Edc-Consumer"))
        if status != 200 or not decision.get("allow"):
            return self.send(403 if status in (200, 403) else 503, {"reason": decision.get("reason", "denied")})
        payload = json.loads(file.read_text())
        licence = decision["license"]
        payload["_reedLicense"] = {**licence, "watermark": watermark(payload, licence)}
        self.send(200, payload)

    def log_message(self, fmt, *args) -> None:
        sys.stderr.write(f"[{COMPANY}] {fmt % args}\n")


def main() -> None:
    port = int(os.environ.get("PORT", "8090"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    cert, key = os.environ.get("TLS_CERT"), os.environ.get("TLS_KEY")
    if cert and key:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(cert, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"reed data service for {COMPANY} on :{port} ({'https' if cert else 'http'})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
