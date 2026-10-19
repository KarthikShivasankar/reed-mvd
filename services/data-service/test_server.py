"""Self-check of the watermark: a payload or licence changed after release no longer verifies."""
import os
os.environ.setdefault("DATA_KEY", "k"); os.environ.setdefault("COMPANY", "c")
import server  # noqa: E402

payload, licence = {"a": 1}, {"licensee": "BPN-1", "agreementId": "x"}
mark = server.watermark(payload, licence)
assert mark == server.watermark({"a": 1}, {"agreementId": "x", "licensee": "BPN-1"})  # key order irrelevant
assert mark != server.watermark({"a": 2}, licence)
assert mark != server.watermark(payload, {**licence, "licensee": "BPN-2"})
print("ok")
