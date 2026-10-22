#!/usr/bin/env python3
"""Generate the REED deployment from deployment/roster.json (stdlib only).

The roster is the single source of truth for participants. This script writes
everything that depends on it:

  deployment/docker-compose.yml             the whole stack (GENERATED - edit the template here)
  deployment/<connector>/config.properties  one EDC connector per member with a connector
  deployment/identityhub/<name>.properties  one IdentityHub per identity (each member + the FC operator)
  deployment/issuerservice/config.properties
  deployment/federated-catalog/{config.properties,participants.json}
  deployment/dashboard/config.json
  deployment/keycloak/reed-realm.json       realm, roles, clients, synthetic demo users
  deployment/postgres/init.sql              one database per service
  deployment/vault-init/init.sh             initialise/unseal Vault, per-member folders, policies, tokens
  deployment/vault/keys/*.pem               EDR signing keys (only if missing; gitignored)
  deployment/.env                           generated secrets (gitignored; kept if present)

Usage:  python3 tools/gen_topology.py            # idempotent; re-run after editing the roster
"""
import base64
import json
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEP = ROOT / "deployment"
roster = json.loads((DEP / "roster.json").read_text())
DS = roster["dataspace"]
PARTICIPANTS = roster["participants"]
CONNECTORS = [p for p in PARTICIPANTS if p.get("connector")]
FACTORIES = [p for p in CONNECTORS if p.get("factory")]  # companies with a (simulated) shop-floor line
# The browser talks to one origin: the dashboard's nginx proxies Keycloak (/realms, /resources, ...), the backend
# (/reed) and the connectors' public data planes (/dp/), so a remote host needs only port 8088 forwarded.
# An IP, not "localhost": browsers never apply HSTS / https-upgrades to IP addresses.
DASHBOARD_ORIGIN = "http://127.0.0.1:8088"
KEYCLOAK_URL = DASHBOARD_ORIGIN  # browser-facing Keycloak, proxied
FC_PREFIX = "39"
ISSUER_DID = "did:web:issuerservice%3A10016:issuer"


def write(path: Path, text: str, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_text() != text:
        path.write_text(text)
        print(f"  wrote {path.relative_to(ROOT)}")
    if mode is not None:
        path.chmod(mode)


def upper(name: str) -> str:
    return name.upper().replace("-", "_")


def did(name: str) -> str:
    """Each identity is hosted by its own IdentityHub: did:web:<name>-ih%3A7083:<name>."""
    return f"did:web:{name}-ih%3A7083:{name}"


def db(name: str) -> str:
    return name.replace("-", "_")


# Identities = every consortium member running a connector + the operator running the federated
# catalog. Each gets its own IdentityHub, Vault folder, Vault token and database.
IDENTITIES = [{"name": c["connector"]["name"], "prefix": c["connector"]["portPrefix"], "title": c["name"]}
              for c in CONNECTORS if c.get("consortium", True)]
for p in PARTICIPANTS:
    if p.get("identity"):
        IDENTITIES.append({"name": p["identity"], "prefix": FC_PREFIX, "title": p["name"]})


# ----------------------------------------------------------------- secrets (.env)
def load_env() -> dict:
    env = {}
    f = DEP / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k] = v
    return env


env = load_env()


def secret(key: str) -> str:
    if key not in env:
        env[key] = secrets.token_urlsafe(24)
    return env[key]


def api_key(key: str) -> str:
    """IdentityHub/Issuer admin keys have the shape base64(super-user).base64(secret)."""
    if key not in env:
        env[key] = base64.b64encode(b"super-user").decode() + "." + base64.b64encode(secrets.token_bytes(24)).decode()
    return env[key]


for c in CONNECTORS:
    secret("MGMT_KEY_" + upper(c["connector"]["name"]))
    secret("DATA_KEY_" + upper(c["connector"]["name"]))      # connector data plane -> own data service
    secret("CALLBACK_KEY_" + upper(c["connector"]["name"]))  # connector -> REED backend EDC callbacks
secret("MGMT_KEY_FEDERATED_CATALOG")
for i in IDENTITIES:
    api_key("IH_KEY_" + upper(i["name"]))
    secret("VAULT_TOKEN_" + upper(i["name"]))
api_key("ISSUER_KEY")
secret("VAULT_TOKEN_ISSUER")
secret("LITELLM_MASTER_KEY")
secret("POSTGRES_PASSWORD")
secret("KEYCLOAK_ADMIN_PASSWORD")
secret("MQTT_PASSWORD_REED_BACKEND")
for f in FACTORIES:
    secret("MQTT_PASSWORD_" + upper(f["connector"]["name"]))  # the company's shop-floor devices
for stale in ("IH_SUPERUSER_KEY", "REED_SUBMODEL_KEY"):  # from earlier layouts
    env.pop(stale, None)
env["REED_DATA_KEYS"] = ",".join(f'{c["connector"]["name"]}=${{DATA_KEY_{upper(c["connector"]["name"])}}}' for c in CONNECTORS)
env["REED_CALLBACK_KEYS"] = ",".join(f'{c["connector"]["name"]}=${{CALLBACK_KEY_{upper(c["connector"]["name"])}}}' for c in CONNECTORS)
env["REED_MGMT_KEYS"] = ",".join(
    [f'{c["connector"]["name"]}=${{MGMT_KEY_{upper(c["connector"]["name"])}}}' for c in CONNECTORS]
    + ["federated-catalog=${MGMT_KEY_FEDERATED_CATALOG}"])
write(DEP / ".env", "# GENERATED by tools/gen_topology.py - local secrets, never commit.\n"
      + "".join(f"{k}={v}\n" for k, v in sorted(env.items())), mode=0o600)


# ----------------------------------------------------------------- EDR signing keys
def ensure_keys(name: str) -> None:
    keys = DEP / "vault" / "keys"
    keys.mkdir(parents=True, exist_ok=True)
    priv, pub = keys / f"{name}-signing-key.pem", keys / f"{name}-verification-key.pem"
    if priv.exists() and pub.exists():
        return
    subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(priv)], check=True)
    subprocess.run(["openssl", "ec", "-in", str(priv), "-pubout", "-out", str(pub)], check=True,
                   stderr=subprocess.DEVNULL)
    print(f"  generated EC P-256 keys for {name}")


for c in CONNECTORS:
    ensure_keys(c["connector"]["name"])


# ----------------------------------------------------------------- confidential payloads
# Each company's payloads live only with its own data service (deployment/payloads/<name>/, gitignored):
# the supplier's ProcessCapability from its confidential capability in the roster, other classes from
# deployment/payload-templates/.
def kebab(cls: str) -> str:
    import re
    return re.sub(r"([a-z])([A-Z])", r"\1-\2", cls).lower()


for c in CONNECTORS:
    n = c["connector"]["name"]
    for cls in c.get("assets", []):
        if cls == "ProcessCapability" and c.get("confidentialCapability"):
            payload = dict(c["confidentialCapability"])
        else:
            payload = json.loads((DEP / "payload-templates" / f"{kebab(cls)}.json").read_text())
        payload.update({"assetClass": cls, "owner": c["name"], "ownerBpn": c["bpn"]})
        write(DEP / "payloads" / n / f"{kebab(cls)}-{n}.json", json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------- shared config fragments
def vault_cfg(folder: str) -> str:
    # Token comes from the environment (EDC_VAULT_HASHICORP_TOKEN); it only grants secret/<folder>/*.
    return f"""edc.vault.hashicorp.url=http://vault:8200
edc.vault.hashicorp.folder={folder}
edc.vault.hashicorp.health.check.enabled=false
"""


def datasource(database: str, prefix: str = "default") -> str:
    # Password comes from the environment (EDC_DATASOURCE_<PREFIX>_PASSWORD).
    return f"""edc.datasource.{prefix}.url=jdbc:postgresql://postgres:5432/{database}
edc.datasource.{prefix}.user=reed
"""


CORS = """edc.web.rest.cors.enabled=true
edc.web.rest.cors.origins=*
edc.web.rest.cors.headers=origin, content-type, accept, authorization, x-api-key
edc.web.rest.cors.methods=GET, POST, DELETE, PUT, OPTIONS
"""


def dcp(name: str) -> str:
    """Decentralized Claims Protocol: the runtime's id is its DID; tokens come from its own IdentityHub's
    STS; only credentials issued by the REED issuer are trusted."""
    out = f"""
# --- Decentralized Claims Protocol (DCP) ---
edc.hostname={name}
edc.iam.did.web.use.https=false
edc.iam.credential.revocation.mimetype=application/json
edc.iam.sts.oauth.token.url=http://{name}-ih:7084/api/sts/token
edc.iam.sts.oauth.client.id={did(name)}
edc.iam.sts.oauth.client.secret.alias={name}-sts-client-secret
edc.iam.trustedissuer.reed.id={ISSUER_DID}
# All three REED credentials are DEFAULT scopes, i.e. presented on every DSP request: catalog
# requests carry no policy, so a POLICY-scoped (prefix-mapped) credential would never reach the
# access-policy check that hides bilateral/project assets.
"""
    for scope, vc in (("membership", "MembershipCredential"), ("certification", "CertificationCredential"),
                      ("supplierrelation", "SupplierRelationCredential")):
        out += f"""edc.iam.dcp.scopes.{scope}.id={scope}-scope
edc.iam.dcp.scopes.{scope}.type=DEFAULT
edc.iam.dcp.scopes.{scope}.value=org.eclipse.dspace.dcp.vc.type:{vc}:read
"""
    return out


def web(px: str, public: bool) -> str:
    out = f"""web.http.port={px}191
web.http.path=/api
web.http.control.port={px}192
web.http.control.path=/control
web.http.management.port={px}193
web.http.management.path=/management
web.http.protocol.port={px}194
web.http.protocol.path=/protocol
web.http.version.port={px}195
web.http.version.path=/version
"""
    if public:
        out += f"""web.http.public.port={px}291
web.http.public.path=/public
"""
    return out


# ----------------------------------------------------------------- connector configs
def connector_config(p: dict) -> str:
    name, px = p["connector"]["name"], p["connector"]["portPrefix"]
    return f"""# GENERATED by tools/gen_topology.py from deployment/roster.json - do not edit.
# {p["name"]} ({p["bpn"]}), {p["city"]}, {p["country"]} - role {p["role"]}
edc.participant.id={did(name)}
edc.runtime.id={name}

{web(px, public=True)}
# DSP callback: resolved connector-to-connector inside Docker -> service name.
edc.dsp.callback.address=http://{name}:{px}194/protocol

# Data-plane public API: called by browsers/scripts with an EDR -> localhost.
edc.dataplane.api.public.baseurl=http://localhost:{px}291/public/
edc.transfer.proxy.token.signer.privatekey.alias={name}-signing-key
edc.transfer.proxy.token.verifier.publickey.alias={name}-verification-key

# Management API protected by a per-connector key (held server-side by the REED backend).
web.http.management.auth.type=tokenbased
web.http.management.auth.key.alias={name}-mgmt-api-key

# Stores (assets, policies, negotiations, agreements, transfers, EDRs, CEL rules) in Postgres.
{datasource("edc_" + db(name))}edc.sql.schema.autocreate=true

{vault_cfg(name)}
{CORS}{dcp(name)}"""


for c in CONNECTORS:
    write(DEP / c["connector"]["name"] / "config.properties", connector_config(c))

write(DEP / "federated-catalog" / "config.properties", f"""# GENERATED by tools/gen_topology.py - do not edit.
# Federated catalog, run by the dataspace operator with its own DID and MembershipCredential.
edc.participant.id={did("federated-catalog")}
edc.runtime.id=federated-catalog

{web(FC_PREFIX, public=False)}
# Crawl every participant every 15 s (participants.json is re-read each cycle).
edc.catalog.cache.execution.delay.seconds=5
edc.catalog.cache.execution.period.seconds=15
edc.catalog.cache.partition.num.crawlers=2
edc.mvd.participants.file=/app/config/participants.json

web.http.management.auth.type=tokenbased
web.http.management.auth.key.alias=federated-catalog-mgmt-api-key

{vault_cfg("federated-catalog")}
{CORS}{dcp("federated-catalog")}""")

write(DEP / "federated-catalog" / "participants.json", json.dumps([
    {"name": c["connector"]["name"], "id": did(c["connector"]["name"]),
     "url": f'http://{c["connector"]["name"]}:{c["connector"]["portPrefix"]}194/protocol/2025-1',
     "supportedProtocols": ["dataspace-protocol-http:2025-1"]} for c in CONNECTORS], indent=2) + "\n")


# ----------------------------------------------------------------- identity services
IDENTITY_COMMON = """edc.iam.did.web.use.https=false
edc.iam.credential.revocation.mimetype=application/json
edc.iam.accesstoken.jti.validation=true
edc.encryption.aes.key.alias=aes-key-alias
edc.sql.schema.autocreate=true
# edc.ih.api.superuser.key, the Vault token and the database password come from the environment.
"""

for i in IDENTITIES:
    n = i["name"]
    write(DEP / "identityhub" / f"{n}.properties", f"""# GENERATED by tools/gen_topology.py - do not edit.
# IdentityHub of {i["title"]}: its DID document, keys, verifiable credentials and STS.
# {did(n)} -> http://{n}-ih:7083/{n}/did.json
edc.hostname={n}-ih
web.http.port=7080
web.http.path=/api
web.http.identity.port=7081
web.http.identity.path=/api/identity
web.http.credentials.port=7082
web.http.credentials.path=/api/credentials
web.http.did.port=7083
web.http.did.path=/
web.http.sts.port=7084
web.http.sts.path=/api/sts
web.http.version.port=7085
web.http.version.path=/version
{datasource("ih_" + db(n))}edc.iam.credential.renewal.graceperiod=86400
{vault_cfg(n)}{IDENTITY_COMMON}""")

write(DEP / "issuerservice" / "config.properties", f"""# GENERATED by tools/gen_topology.py - do not edit.
# REED Issuer Service ({ISSUER_DID}): issues MembershipCredential, CertificationCredential and
# SupplierRelationCredential from "database" attestations = the vc_* views in the REED backend DB.
edc.hostname=issuerservice
web.http.port=10010
web.http.path=/api
web.http.sts.port=10011
web.http.sts.path=/api/sts
web.http.issuance.port=10012
web.http.issuance.path=/api/issuance
web.http.issueradmin.port=10013
web.http.issueradmin.path=/api/admin
web.http.version.port=10014
web.http.version.path=/version
web.http.identity.port=10015
web.http.identity.path=/api/identity
web.http.did.port=10016
web.http.did.path=/
web.http.statuslist.port=9999
web.http.statuslist.path=/statuslist
edc.issuer.statuslist.signing.key.alias=statuslist-signing-key
{datasource("issuer")}# Attestation source: the REED registry (read-only views vc_membership, vc_certification, vc_supplier_relation)
{datasource("reed", "reed")}{vault_cfg("issuer")}{IDENTITY_COMMON}""")

databases = ["keycloak", "issuer"] + ["ih_" + db(i["name"]) for i in IDENTITIES] \
    + ["edc_" + db(c["connector"]["name"]) for c in CONNECTORS]
write(DEP / "postgres" / "init.sql", "-- GENERATED by tools/gen_topology.py. Runs once on first Postgres start.\n"
      + "".join(f"CREATE DATABASE {d};\n" for d in databases))


# ----------------------------------------------------------------- vault initialisation
vault_identities = [i["name"] for i in IDENTITIES] + ["issuer"]
init_sh = """#!/bin/sh
# GENERATED by tools/gen_topology.py - do not edit.
# Runs on every `docker compose up`. Vault keeps its data in file storage (survives restarts).
#  - First run: initialise, then with the root token create one folder secret/<name>/, a policy limited
#    to it and a periodic token per identity (token values from deployment/.env). Then the root token is
#    REVOKED and removed from disk: no long-lived root token exists afterwards.
#  - Every run: unseal, then load each identity's keys with that identity's OWN token.
# ponytail: the unseal key stays in a local volume next to Vault - removing it needs auto-unseal against
# an external KMS/HSM, which a single host does not have.
# ponytail: tokens get fixed ids from .env so EDC config can reference them; Vault then hashes those ids
# with SHA-1 for lookups (it warns). Production: issue tokens via AppRole/Kubernetes auth instead.
set -eu
export VAULT_ADDR=http://vault:8200
INIT=/vault/init/init.txt

if ! wget -qO- "$VAULT_ADDR/v1/sys/init" | grep -q '"initialized":true'; then
  vault operator init -key-shares=1 -key-threshold=1 > "$INIT"
  chmod 600 "$INIT"
  echo "Vault initialised."
fi
vault operator unseal "$(awk '/Unseal Key 1:/ {print $NF}' "$INIT")" > /dev/null

provision() { # provision <folder> <token>   (root token required)
  printf 'path "secret/data/%s/*" { capabilities = ["create", "read", "update", "delete", "list"] }\\npath "secret/metadata/%s/*" { capabilities = ["read", "list", "delete"] }\\n' "$1" "$1" \\
    | vault policy write "reed-$1" - > /dev/null
  vault token lookup "$2" > /dev/null 2>&1 \\
    || vault token create -id="$2" -policy="reed-$1" -orphan -period=768h -display-name="$1" > /dev/null
}

ROOT="$(awk '/Initial Root Token:/ {print $NF}' "$INIT")"
if [ -n "$ROOT" ]; then   # first run (or a Vault set up before the root token was revoked)
  export VAULT_TOKEN="$ROOT"
  vault secrets list | grep -q '^secret/' || vault secrets enable -path=secret kv-v2 > /dev/null
"""
for n in vault_identities:
    init_sh += f'  provision {n} "$VAULT_TOKEN_{upper(n)}"\n'
init_sh += """  vault token revoke -self > /dev/null
  grep -v 'Initial Root Token' "$INIT" > "$INIT.tmp" && mv "$INIT.tmp" "$INIT" && chmod 600 "$INIT"
  unset VAULT_TOKEN
  echo "Identities provisioned; root token revoked."
fi

# From here on every write uses the identity's own token - each can only touch secret/<name>/.
aes() { # aes <folder> <token>: data-encryption key for IdentityHub/Issuer, created once, never rotated here
  VAULT_TOKEN="$2" vault kv get "secret/$1/aes-key-alias" > /dev/null 2>&1 \\
    || VAULT_TOKEN="$2" vault kv put "secret/$1/aes-key-alias" content="$(head -c 32 /dev/urandom | base64)" > /dev/null
}
"""
for n in vault_identities:
    init_sh += f'aes {n} "$VAULT_TOKEN_{upper(n)}"\n'
for c in CONNECTORS:
    n = c["connector"]["name"]
    t = f'"$VAULT_TOKEN_{upper(n)}"'
    init_sh += (f'VAULT_TOKEN={t} vault kv put secret/{n}/{n}-signing-key content=@/keys/{n}-signing-key.pem > /dev/null\n'
                f'VAULT_TOKEN={t} vault kv put secret/{n}/{n}-verification-key content=@/keys/{n}-verification-key.pem > /dev/null\n'
                f'VAULT_TOKEN={t} vault kv put secret/{n}/{n}-mgmt-api-key content="$MGMT_KEY_{upper(n)}" > /dev/null\n'
                f'VAULT_TOKEN={t} vault kv put secret/{n}/{n}-callback-key content="$CALLBACK_KEY_{upper(n)}" > /dev/null\n')
init_sh += ('VAULT_TOKEN="$VAULT_TOKEN_FEDERATED_CATALOG" vault kv put secret/federated-catalog/federated-catalog-mgmt-api-key content="$MGMT_KEY_FEDERATED_CATALOG" > /dev/null\n'
            'echo "Vault ready: ' + str(len(vault_identities)) + ' identities, each confined to secret/<name>/, no root token."\n')
write(DEP / "vault-init" / "init.sh", init_sh, mode=0o755)
write(DEP / "vault-init" / "vault.hcl", """# GENERATED by tools/gen_topology.py - do not edit.
storage "file" {
  path = "/vault/file"
}
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}
api_addr      = "http://vault:8200"
disable_mlock = true
ui            = false
""")

# ----------------------------------------------------------------- dashboard config
write(DEP / "dashboard" / "config.json", json.dumps({
    "reedBackendUrl": DASHBOARD_ORIGIN,  # proxied by the dashboard's nginx
    "keycloak": {"url": KEYCLOAK_URL, "realm": "reed", "clientId": "reed-dashboard"},
    "identityMode": "dcp",
    "connectors": [{
        "name": c["connector"]["name"], "bpn": c["bpn"], "company": c["name"], "short": c["short"],
        "participantId": did(c["connector"]["name"]),
        "dspUrl": f'http://{c["connector"]["name"]}:{c["connector"]["portPrefix"]}194/protocol/2025-1',
        "publicUrl": f'http://localhost:{c["connector"]["portPrefix"]}291/public/',
        "factory": bool(c.get("factory"))} for c in CONNECTORS],
}, indent=2, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------- keycloak realm
def user(username, roles, bpn=None, participant=None):
    attrs = {}
    if bpn:
        attrs["bpn"] = [bpn]
    if participant:
        attrs["participant"] = [participant]
    return {
        "username": username, "enabled": True, "emailVerified": True,
        # Synthetic person data only - never a real name, never the company name.
        "firstName": "Demo", "lastName": "User",
        "email": f"{username}@reed.example",
        "attributes": attrs,
        "credentials": [{"type": "password", "value": DS["demoPassword"], "temporary": False}],
        "realmRoles": roles, "requiredActions": [],
    }


users = [user(u["username"], u["roles"]) for u in roster.get("adminUsers", [])]
for p in PARTICIPANTS:
    for u in p.get("users", []):
        users.append(user(u["username"], u["roles"], p["bpn"],
                          p["connector"]["name"] if p.get("connector") else None))


def attr_mapper(attr):
    return {"name": attr, "protocol": "openid-connect", "protocolMapper": "oidc-usermodel-attribute-mapper",
            "config": {"user.attribute": attr, "claim.name": attr, "jsonType.label": "String",
                       "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true",
                       "introspection.token.claim": "true"}}


# Organisation claims (bpn, participant) + the reed-backend audience on every client's tokens.
# (Defined per client, not as a realm clientScopes list: importing clientScopes would replace
# Keycloak's built-in profile/roles/basic scopes.)
ORG_MAPPERS = [attr_mapper("bpn"), attr_mapper("participant"), {
    "name": "reed-backend-audience", "protocol": "openid-connect", "protocolMapper": "oidc-audience-mapper",
    "config": {"included.custom.audience": "reed-backend", "access.token.claim": "true",
               "id.token.claim": "false", "introspection.token.claim": "true"}}]

profile = {
    "unmanagedAttributePolicy": "ADMIN_VIEW",
    "attributes": [
        {"name": "username", "displayName": "${username}", "validations": {"length": {"min": 3, "max": 255}},
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "email", "displayName": "${email}", "validations": {"email": {}},
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "firstName", "displayName": "${firstName}",
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "lastName", "displayName": "${lastName}",
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "bpn", "displayName": "Business Partner Number",
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "participant", "displayName": "Dataspace connector",
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
    ],
    "groups": [],
}

realm = {
    "realm": "reed", "enabled": True, "displayName": "REED Manufacturing Data Space",
    "sslRequired": "none", "registrationAllowed": False, "loginWithEmailAllowed": False,
    "bruteForceProtected": True, "failureFactor": 10,
    "accessTokenLifespan": 900, "ssoSessionIdleTimeout": 3600,
    "roles": {"realm": [
        {"name": "buyer", "description": "Posts RFQs, shortlists and confirms matches for its organisation"},
        {"name": "supplier-engineer", "description": "Answers matches and opportunities for its organisation"},
        {"name": "quality-auditor", "description": "Reads audit trail and gives delivery feedback"},
        {"name": "admin", "description": "Dataspace operator (seeding, all views)"},
    ]},
    "clients": [
        {"clientId": "reed-dashboard", "name": "REED Dashboard", "publicClient": True, "enabled": True,
         "standardFlowEnabled": True, "directAccessGrantsEnabled": False, "implicitFlowEnabled": False,
         "redirectUris": [f"{DASHBOARD_ORIGIN}/*"], "webOrigins": [DASHBOARD_ORIGIN],
         "attributes": {"pkce.code.challenge.method": "S256", "post.logout.redirect.uris": f"{DASHBOARD_ORIGIN}/*"},
         "protocolMappers": ORG_MAPPERS,
         "defaultClientScopes": ["basic", "profile", "email", "roles", "web-origins"]},
        {"clientId": "reed-cli", "name": "REED scripts (password grant, demo only)", "publicClient": True,
         "enabled": True, "standardFlowEnabled": False, "directAccessGrantsEnabled": True,
         "protocolMappers": ORG_MAPPERS,
         "defaultClientScopes": ["basic", "profile", "email", "roles"]},
    ],
    "users": users,
    "components": {"org.keycloak.userprofile.UserProfileProvider": [{
        "providerId": "declarative-user-profile", "subComponents": {},
        "config": {"kc.user.profile.config": [json.dumps(profile)]}}]},
}
write(DEP / "keycloak" / "reed-realm.json", json.dumps(realm, indent=2, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------- docker-compose.yml
# Every published port is bound to 127.0.0.1: admin APIs, databases and Vault are never reachable
# from the network, and browser-facing URLs are localhost anyway.
def ports(*pairs: str) -> str:
    return "[" + ", ".join(f'"127.0.0.1:{p}"' for p in pairs) + "]"


JAVA = """      JAVA_TOOL_OPTIONS: -XX:MaxRAMPercentage=75
"""


def edc_env(folder: str, extra: str = "") -> str:
    return f"""    environment:
      EDC_VAULT_HASHICORP_TOKEN: ${{VAULT_TOKEN_{upper(folder)}}}
      EDC_DATASOURCE_DEFAULT_PASSWORD: ${{POSTGRES_PASSWORD}}
{extra}{JAVA}"""


# ----------------------------------------------------------------- MQTT broker (shop floor)
# Mosquitto with a password per client. Each company's devices log in with the company's connector name
# and may only publish sensor readings under reed/factory/<company>/; the REED backend reads every line and publishes
# alerts and operator observations. Passwords come from .env and are hashed when the broker starts.
write(DEP / "mosquitto" / "mosquitto.conf", """# GENERATED by tools/gen_topology.py
listener 1883
allow_anonymous false
password_file /mosquitto/data/passwd
acl_file /mosquitto/config/acl
persistence true
persistence_location /mosquitto/data/
# the backend has a persistent session: readings queue while it restarts (QoS 1)
max_queued_messages 100000
log_dest stdout
""")
write(DEP / "mosquitto" / "acl", """# GENERATED by tools/gen_topology.py
# REED backend: reads every line's sensors, publishes alerts and operator observations
user reed-backend
topic readwrite reed/factory/#

# a company's devices (username = its connector name) publish only sensor readings under their own company:
# <machine>/<sensor> and its history - never alerts or observations, which only REED publishes
pattern write reed/factory/%u/+/+
pattern write reed/factory/%u/+/+/history
# and receive the commands REED sends to their own line (operator controls on the dashboard)
pattern read reed/factory/%u/control
""")
MQTT_USERS = [("reed-backend", "MQTT_PASSWORD_REED_BACKEND")] + [
    (f["connector"]["name"], "MQTT_PASSWORD_" + upper(f["connector"]["name"])) for f in FACTORIES]


def factory_service(p: dict) -> str:
    name = p["connector"]["name"]
    return f"""
  # {p["short"]}'s shop-floor devices (simulated demo line from the roster): sensors over MQTT.
  {name}-factory:
    image: reed/factory-sim:local
    build:
      context: ../services/factory-sim
    container_name: reed-{name}-factory
    depends_on:  # the backend's persistent MQTT session must exist before the history backfill
      reed-backend:
        condition: service_healthy
    environment:
      COMPANY: {name}
      MQTT_PASSWORD: ${{MQTT_PASSWORD_{upper(name)}}}
    mem_limit: 64m
    volumes:
      - ./roster.json:/app/roster.json:ro
      - reed-factory-{name}:/state
"""


def identityhub_service(i: dict) -> str:
    n, px = i["name"], i["prefix"]
    return f"""
  # IdentityHub of {i["title"]}
  {n}-ih:
    image: reed/identityhub:local
    build:
      context: ../launchers/identity-hub
    container_name: reed-{n}-ih
    depends_on:
      vault-init:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy
      # its credential watchdog checks revocation status lists at the issuer on start; if the issuer
      # is not up yet the credentials are moved to ERROR and never recover
      issuerservice:
        condition: service_healthy
{edc_env(n, f"      EDC_IH_API_SUPERUSER_KEY: ${{IH_KEY_{upper(n)}}}{chr(10)}")}    mem_limit: 1g
    volumes:
      - ./identityhub/{n}.properties:/app/config/config.properties:ro
    ports: {ports(f"{px}081:7081")}   # identity admin API (x-api-key), used by seed-identity.sh
    healthcheck:
      test: ["CMD", "curl", "-fs", "http://127.0.0.1:7080/api/check/readiness"]
      interval: 5s
      retries: 60
"""


def connector_service(p: dict) -> str:
    name, px = p["connector"]["name"], p["connector"]["portPrefix"]
    return f"""
  # {p["name"]} - {p["role"]} ({p["city"]}, {p["country"]})
  {name}:
    image: reed/connector:local
    build:
      context: ../launchers/connector
    container_name: reed-{name}
    depends_on:
      vault-init:
        condition: service_completed_successfully
      reed-backend:
        condition: service_healthy
      {name}-ih:
        condition: service_healthy
{edc_env(name)}    mem_limit: 1g
    volumes:
      - ./{name}/config.properties:/app/config/config.properties:ro
    ports: {ports(f"{px}193:{px}193", f"{px}291:{px}291")}   # Management API (key-protected) + public data plane

  # {p["short"]}'s own data service: holds its confidential payloads, releases them only to its data
  # plane, after a REED usage decision, stamped with a licence + watermark. Not published to the host.
  {name}-data:
    image: reed/data-service:local
    build:
      context: ../services/data-service
    container_name: reed-{name}-data
    depends_on:
      reed-backend:
        condition: service_healthy
    environment:
      COMPANY: {name}
      DATA_KEY: ${{DATA_KEY_{upper(name)}}}
    mem_limit: 128m
    volumes:
      - ./payloads/{name}:/data:ro
"""


vault_env = "".join(f"      VAULT_TOKEN_{upper(n)}: ${{VAULT_TOKEN_{upper(n)}}}\n" for n in vault_identities) \
    + "".join(f"      MGMT_KEY_{upper(c['connector']['name'])}: ${{MGMT_KEY_{upper(c['connector']['name'])}}}\n"
              f"      CALLBACK_KEY_{upper(c['connector']['name'])}: ${{CALLBACK_KEY_{upper(c['connector']['name'])}}}\n"
              for c in CONNECTORS) + "      MGMT_KEY_FEDERATED_CATALOG: ${MGMT_KEY_FEDERATED_CATALOG}\n"

compose = f"""# GENERATED by tools/gen_topology.py from deployment/roster.json - do not edit by hand.
# Secrets are interpolated from deployment/.env (generated, gitignored).
name: reed

services:
  # ---------- HashiCorp Vault (file storage: secrets survive restarts) ----------
  vault:
    image: hashicorp/vault:1.17
    container_name: reed-vault
    cap_add: [IPC_LOCK]
    command: ["server"]   # the image entrypoint adds -config=/vault/config
    volumes:
      - ./vault-init/vault.hcl:/vault/config/vault.hcl:ro
      - reed-vault-data:/vault/file
    ports: {ports("8200:8200")}
    healthcheck:
      # healthy as soon as it answers, sealed or not - vault-init unseals it
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8200/v1/sys/health?sealedcode=200&uninitcode=200"]
      interval: 2s
      retries: 30

  # Initialises/unseals Vault and provisions one folder, policy and token per identity.
  vault-init:
    image: hashicorp/vault:1.17
    container_name: reed-vault-init
    depends_on:
      vault:
        condition: service_healthy
    environment:
{vault_env}    volumes:
      - ./vault-init/init.sh:/init.sh:ro
      - ./vault/keys:/keys:ro
      - reed-vault-init:/vault/init
    entrypoint: ["/bin/sh", "/init.sh"]

  # ---------- Postgres: REED registry, Keycloak, Issuer, every IdentityHub and connector ----------
  postgres:
    image: postgres:16-alpine
    container_name: reed-postgres
    environment:
      POSTGRES_DB: reed
      POSTGRES_USER: reed
      POSTGRES_PASSWORD: ${{POSTGRES_PASSWORD}}
    volumes:
      - reed-pgdata:/var/lib/postgresql/data
      - ./postgres:/docker-entrypoint-initdb.d:ro
    ports: {ports("5432:5432")}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U reed -d reed"]
      interval: 2s
      retries: 30

  # ---------- Keycloak (production mode, Postgres): human login, organisations, roles ----------
  keycloak:
    image: quay.io/keycloak/keycloak:26.6.3
    container_name: reed-keycloak
    command: ["start", "--import-realm", "--health-enabled=true"]
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: reed
      KC_DB_PASSWORD: ${{POSTGRES_PASSWORD}}
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${{KEYCLOAK_ADMIN_PASSWORD}}
      # ponytail: plain http on localhost; production terminates TLS here (KC_HTTPS_*) or at a proxy.
      KC_HOSTNAME: {KEYCLOAK_URL}
      KC_HOSTNAME_BACKCHANNEL_DYNAMIC: "true"
      KC_HTTP_ENABLED: "true"
    volumes:
      - ./keycloak/reed-realm.json:/opt/keycloak/data/import/reed-realm.json:ro
    ports: {ports("8180:8080")}
    healthcheck:
      test: ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/9000 && printf 'GET /health/ready HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q UP <&3"]
      interval: 5s
      retries: 90

  # ---------- LLM gateway: LiteLLM -> Ollama (host) / vLLM Qwen3.8 by default; frontier APIs opt-in ----------
  # Every LLM call goes through LiteLLM. A frontier route works only when its key is set in deployment/.env
  # and REED_LLM_MODEL names it (see deployment/litellm/config.yaml); unset keys leave it unused.
  litellm:
    image: ghcr.io/berriai/litellm:main-v1.89.2
    container_name: reed-litellm
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    environment:
      LITELLM_MASTER_KEY: ${{LITELLM_MASTER_KEY}}
      ANTHROPIC_API_KEY: ${{ANTHROPIC_API_KEY:-}}
      MISTRAL_API_KEY: ${{MISTRAL_API_KEY:-}}
      OPENAI_API_KEY: ${{OPENAI_API_KEY:-}}
    extra_hosts: ["host.docker.internal:host-gateway"]
    volumes:
      - ./litellm/config.yaml:/app/config.yaml:ro
    ports: {ports("4000:4000")}

  # Optional GPU backend (docker compose --profile vllm up): Qwen3.8 NVFP4 from the local HF cache.
  vllm:
    image: vllm/vllm-openai:nightly
    container_name: reed-vllm
    profiles: ["vllm"]
    ipc: host
    deploy:
      resources:
        reservations:
          devices: [{{driver: nvidia, count: all, capabilities: [gpu]}}]
    environment:
      HF_HUB_OFFLINE: "1"
    volumes:
      - ${{HOME}}/.cache/huggingface:/root/.cache/huggingface
    command: ["--model", "nvidia/Qwen3.8-27B-NVFP4", "--served-model-name", "qwen3.8",
              "--max-model-len", "32768", "--gpu-memory-utilization", "0.45",
              "--enable-auto-tool-choice", "--tool-call-parser", "qwen3_coder", "--reasoning-parser", "qwen3"]
    ports: {ports("8000:8000")}

  # ---------- MQTT broker (shop-floor sensors, alerts, operator observations) ----------
  mosquitto:
    image: eclipse-mosquitto:2.0.20
    container_name: reed-mosquitto
    entrypoint: ["sh", "-c", "set -e; umask 077; {"; ".join(f'mosquitto_passwd {"-c " if i == 0 else ""}-b /mosquitto/data/passwd {u} \\"$${k}\\"' for i, (u, k) in enumerate(MQTT_USERS))}; chown -R mosquitto:mosquitto /mosquitto/data; exec mosquitto -c /mosquitto/config/mosquitto.conf"]
    environment:
{"".join(f"      {k}: ${{{k}}}{chr(10)}" for _, k in MQTT_USERS)}    mem_limit: 64m
    volumes:
      - ./mosquitto:/mosquitto/config:ro
      - reed-mosquitto-data:/mosquitto/data
    ports: {ports("1883:1883")}
    healthcheck:
      test: ["CMD-SHELL", "mosquitto_pub -h 127.0.0.1 -u reed-backend -P \\"$$MQTT_PASSWORD_REED_BACKEND\\" -t reed/factory/health -n"]
      interval: 5s
      retries: 30
{"".join(factory_service(p) for p in FACTORIES)}
  # ---------- REED backend ----------
  reed-backend:
    image: reed/backend:local
    build:
      context: ../services/reed-backend
    container_name: reed-backend
    depends_on:
      postgres:
        condition: service_healthy
      mosquitto:
        condition: service_healthy
      keycloak:
        condition: service_healthy
    environment:
      REED_DB_URL: jdbc:postgresql://postgres:5432/reed
      REED_DB_USER: reed
      REED_DB_PASSWORD: ${{POSTGRES_PASSWORD}}
      REED_MGMT_KEYS: ${{REED_MGMT_KEYS}}
      REED_CALLBACK_KEYS: ${{REED_CALLBACK_KEYS}}
      REED_DATA_KEYS: ${{REED_DATA_KEYS}}
      REED_DID_PATTERN: "did:web:{{name}}-ih%3A7083:{{name}}"
      REED_LLM_API_KEY: ${{LITELLM_MASTER_KEY}}
      REED_LLM_MODEL: ${{REED_LLM_MODEL:-reed-llm}}
      REED_ISSUER: {KEYCLOAK_URL}/realms/reed
      REED_CORS_ORIGINS: {DASHBOARD_ORIGIN}
      REED_MQTT_PASSWORD: ${{MQTT_PASSWORD_REED_BACKEND}}
{JAVA}    volumes:
      - ./roster.json:/app/deployment/roster.json:ro
      - ./scenarios:/app/deployment/scenarios:ro
    ports: {ports("8081:8080")}
    healthcheck:
      test: ["CMD", "curl", "-fs", "http://127.0.0.1:8080/reed/health"]
      interval: 5s
      retries: 60

  # ---------- REED Issuer Service (the dataspace's credential authority) ----------
  issuerservice:
    image: reed/issuerservice:local
    build:
      context: ../launchers/issuerservice
    container_name: reed-issuerservice
    depends_on:
      vault-init:
        condition: service_completed_successfully
      reed-backend:
        condition: service_healthy
{edc_env("issuer", "      EDC_IH_API_SUPERUSER_KEY: ${ISSUER_KEY}" + chr(10) + "      EDC_DATASOURCE_REED_PASSWORD: ${POSTGRES_PASSWORD}" + chr(10))}    mem_limit: 1g
    volumes:
      - ./issuerservice/config.properties:/app/config/config.properties:ro
    ports: {ports("10013:10013", "10015:10015")}   # issuer admin + identity APIs (x-api-key)
    healthcheck:
      test: ["CMD", "curl", "-fs", "http://127.0.0.1:10010/api/check/readiness"]
      interval: 5s
      retries: 60
{"".join(identityhub_service(i) for i in IDENTITIES)}{"".join(connector_service(c) for c in CONNECTORS)}
  # ---------- Federated Catalog (crawls every connector) ----------
  federated-catalog:
    image: reed/federated-catalog:local
    build:
      context: ../launchers/federated-catalog
    container_name: reed-federated-catalog
    depends_on:
      vault-init:
        condition: service_completed_successfully
      federated-catalog-ih:
        condition: service_healthy
{"".join(f"      {c['connector']['name']}:{chr(10)}        condition: service_started{chr(10)}" for c in CONNECTORS)}    environment:
      EDC_VAULT_HASHICORP_TOKEN: ${{VAULT_TOKEN_FEDERATED_CATALOG}}
{JAVA}    mem_limit: 1g
    volumes:
      - ./federated-catalog/config.properties:/app/config/config.properties:ro
      - ./federated-catalog/participants.json:/app/config/participants.json:ro
    ports: {ports(f"{FC_PREFIX}193:{FC_PREFIX}193")}

  # ---------- REED Dashboard (React SPA; login via Keycloak) ----------
  dashboard:
    image: reed/dashboard:local
    build:
      context: ../services/reed-dashboard
    container_name: reed-dashboard
    ports: {ports("8088:8080")}
    volumes:
      - ./dashboard/config.json:/usr/share/nginx/html/config.json:ro

volumes:
  reed-pgdata:
  reed-vault-data:
  reed-vault-init:
  reed-mosquitto-data:
{"".join(f"  reed-factory-{p['connector']['name']}:{chr(10)}" for p in FACTORIES)}"""
write(DEP / "docker-compose.yml", compose)
print(f"topology: {len(CONNECTORS)} connectors, {len(IDENTITIES)} identities (each with its own IdentityHub), "
      f"{len(PARTICIPANTS)} participants, {len(users)} demo users")
