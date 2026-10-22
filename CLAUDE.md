# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**REED** is a European **manufacturing data space with matchmaking** for large industrial parts
(wind, shipbuilding/offshore, rail/heavy machinery, hydropower). It is built on **Eclipse
Dataspace Connector (EDC) `0.17.0`** with **DCP** (IdentityHub + Issuer Service, `did:web`,
verifiable credentials), **Keycloak** for human login, a **Spring Boot/Postgres REED backend**,
a **React** dashboard and a **local LLM** (Qwen3.8 via LiteLLM → Ollama/vLLM), orchestrated
with `docker compose`.

Invariant: *discover that data exists, but receive the payload only after an EDC contract*.
Every connector proves membership, certifications and supply relations with credentials, and
EDC policies are CEL rules over those credentials.

Org/user constraints: every LLM call goes through **LiteLLM** (never a provider SDK from the backend);
default **local** Qwen3.8 (Ollama/vLLM), frontier APIs (Anthropic, Mistral, OpenAI) only as opt-in
routes (key + `REED_LLM_MODEL` in `deployment/.env`, `deployment/litellm/config.yaml`). Send it **no
personal data** (organisation/part data only; redaction in `PersonalDataRedactor`). Companies in the roster are **fictional EU companies** - never attach
fabricated claims to real firms. Exception, on the user's request: **Komatsu Mining Germany GmbH**
(`"illustrative": true`) as a buyer in invented scenarios K1/K2 - no attestations, capabilities,
VAT id or relations for it; keep it labelled illustrative everywhere.

## Build, run, test

```bash
python3 tools/gen_topology.py      # roster -> compose file, configs, realm, keys, deployment/.env (idempotent)
./gradlew :launchers:connector:shadowJar :launchers:federated-catalog:shadowJar \
          :launchers:identity-hub:shadowJar :launchers:issuerservice:shadowJar :services:reed-backend:bootJar
docker compose -f deployment/docker-compose.yml up --build -d    # --profile vllm adds the GPU LLM backend
./seed-identity.sh                 # DIDs + credentials (all ISSUED)
./seed-reed.sh                     # per-owner EDC assets, policies, contract defs, CEL rules
./run-transfer.sh                  # DCP e2e: 1 contract + pull, 2 credential refusals (exit 0 = all PASS)
./run-matchmaking.sh               # 11 scenarios (SCENARIO=K1 for one)
./run-persistence.sh               # down + up with volumes kept: nothing may need re-seeding
./run-factory.sh                   # shop floor: MQTT auth/ACL, live stream, history, observations, briefing, scoping, fault -> alarm
./run-interop.sh                   # every connector x every other: catalogues + contracts match PolicyEvaluator; 8 stories (SCENARIO=X2)
./gradlew :services:reed-backend:test                          # scorer, fixtures, assistant guardrails
cd services/reed-dashboard && npx playwright test              # UI e2e (stack must be up + seeded)
docker compose -f deployment/docker-compose.yml down -v        # -v drops Vault + Postgres (seed again)
```

The host may only have JDK 8: pass `-Porg.gradle.java.installations.paths=<jdk17>` with
`JAVA_HOME=<jdk17>` (a JDK 17 can be copied out of the `eclipse-temurin:17-jdk` image).

## Architecture

### Single source of truth: `deployment/roster.json` + `tools/gen_topology.py`
Participants (BPN, company, role, location, quay/rail, sectors, connector name + port prefix,
attested certifications, relations, public capability, confidential capability, assets, demo
users) live in the roster. The generator writes `deployment/docker-compose.yml` (**generated - do
not hand-edit**), each `deployment/<connector>/config.properties`, one
`deployment/identityhub/<name>.properties` per identity, the issuer config, `deployment/vault-init/`
(Vault config + init script), `deployment/postgres/init.sql`, FC `participants.json`,
`deployment/dashboard/config.json`, the Keycloak realm, PEM keys and `deployment/.env` (all
secrets: mgmt keys, per-identity IH keys and Vault tokens, Postgres/Keycloak passwords; gitignored,
preserved across runs). All published ports bind to 127.0.0.1. Scenario RFQs + expected
outcomes live in `deployment/scenarios/matchmaking.json`; cross-border data-sharing stories (owner terms ->
expected FINALIZED / TERMINATED / HIDDEN per company) in `deployment/scenarios/interop.json`. Both files are bind-mounted into the
backend and seeded into an **empty** database (`down -v` to reseed).

### REED backend (`services/reed-backend/`, package `org.example.reed`)
Spring Boot 3.3 + Postgres, schema by **Flyway** (`db/migration`, Hibernate `validate`).
- `domain/`, `repo/`: participants, per-owner assets, RFQs, matches, relations, audit…
- `security/`: OAuth2 resource server (`SecurityConfig`), `CurrentUser` from the token
  (`bpn`, `participant`, realm roles). Organisation always comes from the token. Cross-org views
  only for operators (`admin`, or `quality-auditor` without a BPN).
- `match/`: `MatchScorer` (pure: hard filters + 6 weighted criteria, deterministic), `MatchService`
  (ranking, partners, opportunities, lifecycle; confirm verifies the EDC agreement on the buyer's
  connector, then pulls the supplier's confidential capability itself through the buyer's connector +
  callback EDR - REED acts as the buyer's agent - and checks it; nothing is stored).
- `assistant/`: `LlmClient` (OpenAI-compatible → LiteLLM), `RuleRfqParser` (numbers are
  authoritative from rules), `PersonalDataRedactor`, `AssistantService` (draft, explain, tool chat;
  explanations with numbers not from the scorer are discarded).
- `policy/`: `PolicyEvaluator` (pure mirror of the CEL rules over the `vc_*` claims, unit-tested),
  `PolicyService` (who gets each asset and why, what-if preview, what a requester can discover - never
  assets it may not discover -, owner-only term changes published to the owner's connector: POST, PUT on
  409; `POLICY` audit). The connectors stay the authority; `run-interop.sh` fails if they disagree.
- `edc/`: `EdcRenderService` renders per-owner assets, access policies (per discoverability) and
  contract policies (template credential constraints) + CEL expressions; `ConnectorClient` calls
  Management APIs with per-connector keys.
- `web/`: REST controllers incl. `ConnectorProxyController` (BFF relay: **allowlisted** Management API
  calls only; transfer/negotiation requests are **rebuilt** from allowlisted fields under a fixed
  context - never filtered - so no caller callback or JSON-LD alias reaches the connector) and `EdcCallbackController`.
- `usage/`: `UsageController` (`POST /reed/usage/decide`, called by the companies' data services with
  their data key: consumer must hold a contract agreement on the owner's connector, pilot licences
  expire; every decision is a PULL audit) and `Licence` (pure, unit-tested).
- The backend holds **no payloads**: each connector company has a data service
  (`services/data-service`, stdlib Python, `<name>-data`, payloads in `deployment/payloads/<name>/`
  generated from the roster + `deployment/payload-templates/`, gitignored) that releases a payload
  only to its own data plane, after a usage decision, stamped with `_reedLicense` + HMAC watermark.
- `DataSeeder` seeds templates, matrix, participants, assets, relations, history, RFQs.

### Identity (DCP) - see `docs/identity-and-trust.md`
- One IdentityHub **per identity** (`<name>-ih`, each connector + `federated-catalog`), REED Issuer
  Service with stock `database` attestations over the backend's `vc_*` views. IdentityHubs must
  start after a healthy issuer (status-list check at startup moves credentials to ERROR otherwise;
  `seed-identity.sh` re-issues anything not ISSUED = state 500).
- Connector `edc.participant.id` **is its DID** `did:web:<name>-ih%3A7083:<name>`.
- Vault: file storage, `vault-init` unseals on every `up` (root token revoked after the first run - new
  identities need `down -v`); each identity has folder `secret/<name>/`
  (`edc.vault.hashicorp.folder`), a policy limited to it and its own token (`VAULT_TOKEN_<NAME>`).
- CEL rules are operator-aware (`this.operator`: EQ/NEQ/IS_ANY_OF/IS_NONE_OF) for `MembershipCredential.role`
  and `.country` (EU/EEA templates); `seed-reed.sh` upserts (PUT on 409), so changed rules reach old connectors.
- All three credential scopes are **DEFAULT** (presented on every request) - catalog requests
  carry no policy, so POLICY-scoped credentials never reach access policies.
- **Policy JSON-LD gotcha**: policy definitions must use context
  `https://w3id.org/edc/connector/management/v2` with **no `@vocab`**, or left operands like
  `MembershipCredential.role` get expanded into the edc namespace and nothing matches. Contract
  requests send the catalog's `hasPolicy[0]` back verbatim + `assigner` + `target`.
- A requester missing a requested credential type gets DSP 401; a requester whose credential
  lacks the value gets a policy denial (`TERMINATED`, `errorDetail` names the constraint).
- `extensions/superuser-seed` creates the admin participant context the non-OAuth 0.17.0 BOMs lack.

### EDC runtimes and extensions
- `launchers/connector` (controlplane-dcp-bom + dataplane-base-bom + CEL + `http-pull-proxy`) -
  one image for all six connectors; `launchers/federated-catalog` (+ `static-node-directory`,
  re-reads `participants.json` each crawl); `launchers/identity-hub`; `launchers/issuerservice`.
- `http-pull-proxy` re-adds the public data plane removed in 0.17.0 (EDR auth, `authKey`/`authCode`
  upstream header).
- Connector stores and CEL expressions are in **Postgres** (`edc_<name>`, SQL BOMs + `cel-store-sql`);
  Keycloak runs in production mode on Postgres. Seeding is needed once per `down -v`.
- `http-pull-proxy` forwards `X-Edc-Consumer` (the verified EDR token's `aud`) to the owner's data service, which passes it to the usage decision (known member + contract agreement required).
- Management APIs: `web.http.management.auth.type=tokenbased`, key alias `<name>-mgmt-api-key` in Vault.
- Management API **v4** everywhere (v4 needs the `management/v2` context and an explicit `@type`
  on every body, incl. `QuerySpec`); CEL rules on `/v5beta/celexpressions`. EDRs are NOT read from the
  connectors' (v3-only) EDR cache: the backend relay adds a `transfer.process.started` callback to every
  transfer (`/reed/edc-callbacks/<connector>`, authenticated with the connector's low-privilege
  `<name>-callback-key` from its Vault folder via `authCodeId` - never the mgmt key; auth properties need full `https://w3id.org/edc/v0.0.1/ns/` IRIs under the v2 context)
  and serves them at `/reed/connectors/<name>/edrs/<transferId>`.
- All EDC `*/request` list endpoints need a `QuerySpec` body.

### Shop floor (`factory/`, `services/factory-sim/`, Factory view)
- A roster participant's `"factory"` (machines -> sensors with unit, `lo`/`hi` limits, `action`) defines its line.
  `<name>-factory` (stdlib Python + paho-mqtt) simulates the devices: value = nominal + daily swing + a wear ramp
  that resets each cycle (+ noise), so backfill and live are one curve. It publishes QoS 1 to
  `reed/factory/<company>/<machine>/<sensor>` every 5 s and backfills `.../history` (1 min) from its last
  published time (7 days on first start; state in volume `reed-factory-<name>`).
- Mosquitto (`deployment/mosquitto/`, generated): a password per client from `.env`, hashed at broker start; ACL
  lets a device (username = connector name) publish only under its own company. Devices start **after** the backend
  is healthy: REED's persistent session (clean session off, QoS 1, `max_queued_messages`) must exist before the
  backfill, and then queues readings while REED restarts.
- `FactoryService` stores readings in `reed_sensor_reading` (PK sensor_key+ts, `ON CONFLICT DO NOTHING`, 30-day
  retention), analyses every sensor each minute with the pure `TrendAnalyzer` (limits, least-squares slope -> hours to
  limit, z vs 7-day baseline, on 1-min averages), publishes status changes on `reed/factory/<c>/alerts`, and streams
  readings/insights/observations to the company's users (SSE, `X-Accel-Buffering: no` for nginx; the dashboard reads
  it with fetch so the bearer token is a header).
- Observations: redacted text -> local LLM tags machine/category/severity/summary (enum-checked, numbers grounded;
  the model may raise severity, never lower it below the `ObservationTagger` rules), fallback rules. Published on
  `reed/factory/<c>/observations` without author or personal data; the original text stays in the company's view.
- Scoping: a user sees only their own company's line (`participant` claim); the operator reads any line
  (`?participant=`) - operators' notes redacted (`redacted_text`), no author - but cannot post observations or steer.
- Toy factory: `POST /reed/factory/control {action: drift|spike|maintain}` (own company only) publishes on
  `reed/factory/<c>/control`; the simulator applies it (drift: past the limit in ~5 min, spike: at once,
  maintain: faults cleared + wear reset for the cycle). ACL: devices write only `<c>/+/+` and `<c>/+/+/history`
  and read only `<c>/control`; alerts/observations are REED's alone.
- Live data product: the usage decision for a `ProductionStatus` asset of a company with a line returns
  `shopFloor` (`FactoryService.summary`), which its data service puts into the payload before watermarking.

### Ports and URL rule
Connector prefixes: 19 nordvind, 29 castellum, 41 hanse, 42 wisla, 43 maasvlakte, 44 rhein-ndt, 45 komatsu,
39 FC (suffixes 191 api, 192 control, 193 management, 194 DSP, 195 version, 291 public). Prefixes
≥ 66 overflow the port range. Container-to-container URLs use service names; browser/host URLs
use `localhost`. Everything is plain http. The browser has one origin, `http://127.0.0.1:8088` (an IP: no HSTS
upgrades): the dashboard's nginx proxies Keycloak (`/realms`, `/resources`, `/admin`; `KC_HOSTNAME` is that
origin, and so is the backend's token issuer), the backend (`/reed`) and connector data planes
(`/dp/<name>:<port>/public/`, rewritten from EDR endpoints in `api.ts`). Scripts use the direct ports.
Dashboard 8088, Keycloak 8180, backend 8081, LiteLLM 4000, vLLM 8000,
IdentityHub admin `<prefix>081`, Issuer admin 10013/10015, Vault 8200, Postgres 5432, MQTT 1883.

### Dashboard (`services/reed-dashboard/`)
React + Vite + TS, keycloak-js login, all calls via the backend (bearer token), hash routing,
role-aware nav. See its README for the file map. Playwright tests in `e2e/`. **Data space** view
(`views/DataSpace.tsx`): owner's who-gets-what board + terms editor (preview, publish), requester's
credentials + discoverable offers with a live contract/pull (`runReedFlow`), the interop stories, why a data space. nginx serves
`index.html` with `no-cache` (hashed assets immutable).
