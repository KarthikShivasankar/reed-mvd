"""Self-check of the watermark: a payload or licence changed after release no longer verifies."""
import os
os.environ.setdefault("DATA_KEY", "k"); os.environ.setdefault("COMPANY", "c")
import server  # noqa: E402

payload, licence = {"a": 1}, {"licensee": "BPN-1", "agreementId": "x"}
mark = server.watermark(payload, licence)
assert mark == server.watermark({"a": 1}, {"agreementId": "x", "licensee": "BPN-1"})  # key order irrelevant
assert mark != server.watermark({"a": 2}, licence)
assert mark != server.watermark(payload, {**licence, "licensee": "BPN-2"})

# only an unambiguous ALLOW releases data
ok = {"decision": "ALLOW", "conditions": [{"id": "c1", "pass": True}], "failed": []}
assert server.allowed(ok)
assert not server.allowed({**ok, "decision": "DENY"})
assert not server.allowed({**ok, "failed": [{"id": "c1"}]})
assert not server.allowed({**ok, "conditions": []})   # a policy with nothing to check is not a permission
assert not server.allowed({}) and not server.allowed(None) and not server.allowed("ALLOW")
assert not server.enforce("a", "did:x", None, {"path": "/v1/policies/x", "input": {}})[0]  # only decision paths
print("ok")
