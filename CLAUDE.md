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

Org/user constraints: the LLM must be **local** (LiteLLM → Ollama/vLLM, Qwen3.8) - never an
external AI API; send it **no personal data** (organisation/part data only; redaction in
`PersonalDataRedactor`). Companies in the roster are **fictional EU companies** - never attach
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
outcomes live in `deployment/scenarios/matchmaking.json`. Both files are bind-mounted into the
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
- `edc/`: `EdcRenderService` renders per-owner assets, access policies (per discoverability) and
  contract policies (template credential constraints) + CEL expressions; `ConnectorClient` calls
  Management APIs with per-connector keys.
- `web/`: REST controllers incl. `ConnectorProxyController` (BFF relay: **allowlisted** Management API
  calls only, caller-supplied `callbackAddresses` always replaced) and `EdcCallbackController`.
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
- Vault: file storage, `vault-init` unseals on every `up`; each identity has folder `secret/<name>/`
  (`edc.vault.hashicorp.folder`), a policy limited to it and its own token (`VAULT_TOKEN_<NAME>`).
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

### Ports and URL rule
Connector prefixes: 19 nordvind, 29 castellum, 41 hanse, 42 wisla, 43 maasvlakte, 44 rhein-ndt, 45 komatsu,
39 FC (suffixes 191 api, 192 control, 193 management, 194 DSP, 195 version, 291 public). Prefixes
≥ 66 overflow the port range. Container-to-container URLs use service names; browser/host URLs
use `localhost`. Dashboard 8088, Keycloak 8180, backend 8081, LiteLLM 4000, vLLM 8000,
IdentityHub admin `<prefix>081`, Issuer admin 10013/10015, Vault 8200, Postgres 5432.

### Dashboard (`services/reed-dashboard/`)
React + Vite + TS, keycloak-js login, all calls via the backend (bearer token), hash routing,
role-aware nav. See its README for the file map. Playwright tests in `e2e/`. nginx serves
`index.html` with `no-cache` (hashed assets immutable).
