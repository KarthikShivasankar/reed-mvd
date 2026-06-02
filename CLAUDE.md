# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**REED** is a domain-specific **manufacturing data space** for sovereign sharing of bulky-part data (process capability, fixtures, quality evidence, simulation results, digital product passports). It is built on **Eclipse Dataspace Connector (EDC) `v0.17.0`** + a **Spring Boot/Postgres REED backend**, orchestrated with `docker compose`.

The EDC flow: the `reed-provider` (an OEM) publishes a catalog (metadata only); a standalone Federated Catalog aggregates participant catalogs; the `consumer-1` partner discovers the provider, negotiates a contract, starts an `HttpData-PULL` transfer, receives an EDR, and uses the EDR JWT to pull the **confidential payload** through the provider's data-plane proxy. The core REED invariant — *discover that data exists, but receive the payload only after a contract is accepted* — is exactly what the catalog-vs-EDR split enforces.

The **REED backend** (`services/reed-backend/`) is the source of truth for the data model: it persists the five REED tables, holds the confidential submodel payloads, and *renders* the EDC assets/policies/contract-definitions that `seed-reed.sh` pushes into the connector. See `docs/reed-data-model.md` for the tables, the eight asset classes, the classification matrix, and the three-layer policy model.

This is still an **experiment**: it uses `iam-mock` (always-allow dataspace trust, no DCP/IdentityHub), a dev-mode Vault, and in-memory EDC stores (only the REED backend is persistent). No TLS. See `README.md` for the topology diagram and `docs/add-participant.md` for adding participants.

## Build, run, test

```bash
# Build the EDC fat JARs + the REED backend boot JAR (all required before docker build)
./gradlew :launchers:connector:shadowJar :launchers:federated-catalog:shadowJar :services:reed-backend:bootJar

# Bring up the whole stack (first run builds the connector/FC/backend images,
# postgres, and the React dashboard via a quick Vite build)
docker compose -f deployment/docker-compose.yml up --build -d

# Seed the reed-provider from the REED backend (idempotent; 409 = already exists = success)
./seed-reed.sh

# Run the full end-to-end discovery → negotiate → EDR → pull demo (this is the integration "test").
# Ends by printing the matching PULL audit event from the REED backend.
./run-transfer.sh

# Teardown (the -v is important — drops the Vault AND Postgres volumes)
docker compose -f deployment/docker-compose.yml down -v
```

There is **no unit test suite**; `run-transfer.sh` is the de-facto end-to-end verification. The scripts accept env-var overrides (e.g. `PROVIDER_ID`, `PROVIDER_DSP`, `ASSET_ID`, `CONSUMER_MGMT`, `PROVIDER_MGMT`, `REED_BACKEND`) — read the top of each script before running against a non-default participant.

Rebuild just the dashboard after editing `services/reed-dashboard/`:
```bash
docker compose -f deployment/docker-compose.yml up --build -d dashboard
```

## Architecture

### REED backend is the source of truth (`services/reed-backend/`)
A standalone **Spring Boot + Postgres** service, independent of the EDC BOMs (shares only the Java 17 toolchain). It is *not* an EDC connector. Responsibilities:
- **Persists the 5 REED tables** (`reed_asset_classification`, `reed_policy_template`, `reed_supply_chain_relation`, `reed_access_request`, `reed_audit_event`), auto-created via `ddl-auto=update` and seeded by `DataSeeder` (the classification matrix + 6 policy templates + supply-chain graph).
- **Submodel service** — `GET /reed/submodels/{assetId}` returns the confidential payload (JSON resources under `resources/submodels/`), requires `X-Api-Key`, and writes a `PULL` audit event. This is the upstream the data-plane proxy pulls from after an EDR is presented.
- **EDC render API** — `GET /reed/edc/{assets|policydefinitions|contractdefinitions}` builds EDC Management payloads from the REED tables. Each asset's `dataAddress` points at its submodel URL with `authKey=X-Api-Key`/`authCode`. `seed-reed.sh` GETs these and POSTs them to the connector → **REED tables drive what the connector offers; EDC stores stay in-memory.**
- **Catalogue/audit APIs** — `GET /reed/catalogue?bpn=` enforces discoverability (see the three-layer policy model below); `/reed/audit`, `/reed/access-requests`, `/reed/classifications`, `/reed/policy-templates`.

The three-layer policy model (`docs/reed-data-model.md`) maps onto EDC like this: **catalogue** layer = REED `/reed/catalogue` visibility + the contract-definition access policy; **contract** layer = the EDC contract policy; **usage** layer = ODRL obligations/prohibitions + the REED `PULL` audit. **Key caveat:** under `iam-mock` there is no verifiable BPN claim, so the EDC policies actually registered are permissive `Set` policies (negotiation must reach `FINALIZED`); the *faithful* constraint-bearing ODRL is rendered by `PolicyTemplateRenderer`, attached to each asset as `reed:odrl`, and enforced REED-side. Don't add BPN/role/time constraints to the *EDC* policy bodies — that breaks negotiation under iam-mock.

### Gradle multi-module layout
- `gradle/libs.versions.toml` pins **EDC 0.17.0** (single source of version truth) and the Spring Boot / Postgres versions for the REED backend. EDC functionality is pulled in via **BOMs** (`controlplane-base-bom`, `dataplane-base-bom`, `federatedcatalog-base-bom`) plus small overlays (`edr-cache-api`, `iam-mock`, `vault-hashicorp`).
- Both EDC launchers run `org.eclipse.edc.boot.system.runtime.BaseRuntime` and produce fat JARs via the Shadow plugin (`connector.jar`, `federated-catalog.jar`); the REED backend produces `reed-backend.jar` via `bootJar`. All three Dockerfiles copy a host-built jar, so the gradle build above must run before `docker compose build`.
- `launchers/connector` is **one image used for both reed-provider and consumer** — they differ only by the mounted `config.properties`. It bundles control-plane + data-plane collocated.
- `launchers/federated-catalog` is the standalone FC runtime, built on `controlplane-base-bom` (in 0.17.0 the FC ships inside the connector repo and its query API lives under the Management context).

### Two custom extensions (`extensions/`)
These exist to fill gaps EDC 0.17.0 left; understand both before touching runtime wiring:

- **`http-pull-proxy`** — EDC 0.17.0 removed the `data-plane-public-api` module. This extension re-adds it in ~100 lines: registers a `PublicEndpointGeneratorService` function for `HttpData` (so the provider mints EDRs pointing at itself) and a JAX-RS `ProxyController` on the `public` web context that authorizes inbound EDR JWTs via `DataPlaneAuthorizationService`, resolves the source `DataAddress`, and reverse-proxies to the backend. It honors extra `DataAddress` props from stock HttpData sources: `queryParams`, `proxyQueryParams`, and `authKey`/`authCode` (static upstream auth header — how the rendered REED assets authenticate to the `reed-backend` submodel service via `X-Api-Key`).
- **`static-node-directory`** — provides a `TargetNodeDirectory` for the FC crawler by reading `participants.json` from disk. The file is **re-read on every crawl cycle**, so adding/removing participants needs no FC restart.

Both register via `META-INF/services/org.eclipse.edc.spi.system.ServiceExtension` (EDC's SPI mechanism). New service extensions must be listed there.

### Configuration model (`deployment/`)
- Each connector has a `deployment/<name>/config.properties` bind-mounted to `/app/config/config.properties`. The Dockerfile sets `EDC_FS_CONFIG` to that path.
- **Critical URL rule** (cause of most connectivity bugs):
  - `edc.dsp.callback.address` and `participants.json` `url` → resolved **connector-to-connector inside Docker** → must use the **Docker service name** (e.g. `http://reed-provider:19194/protocol`). The rendered assets' submodel `baseUrl` (`http://reed-backend:8080/...`) follows the same rule — it is fetched by the provider's data plane inside the network.
  - `edc.dataplane.api.public.baseurl` and dashboard `managementUrl`/`defaultUrl` → called from **browser/host scripts** → must use **`localhost`**.
- **Port convention**: each participant gets a tens-digit prefix (`1x`=reed-provider, `2x`=consumer-1). Suffixes: `x191` default API, `x192` control, `x193` management, `x194` DSP protocol, `x195` version, `x291` public data-plane. The REED backend is on `8081` (host) / `8080` (in-cluster); Postgres on `5432`.
- The DSP protocol path is versioned: `/protocol/2025-1`. The FC query API is `POST /management/v3/catalogs/request` (plural — merged into Management context in 0.17.0), distinct from a connector's point-to-point `POST /management/v3/catalog/request` (singular).

### Vault and EDR JWT signing
HashiCorp Vault (dev mode, root token) holds the EC P-256 key pairs the data-plane uses to sign/verify EDR JWTs (ES256). Each connector resolves keys by alias (`edc.transfer.proxy.token.signer.privatekey.alias` / `...verifier.publickey.alias`). The `init-vault` sidecar uploads PEMs from `deployment/vault/keys/` into `secret/<alias>`. **Without valid parseable keys the provider crashes on first transfer** (`JWSSigner cannot be generated...`). The PEMs are gitignored and generated locally (`reed-provider-*`, `consumer-1-*` under `deployment/vault/keys/` — see README for the openssl commands). Because keys are seeded by `init-vault` into a volume, any key change requires `down -v` to recreate the Vault (and Postgres) volumes.

### Adding a participant
Follow `docs/add-participant.md` — it is the authoritative checklist. A new participant touches: PEM keys, `init-vault` command in `docker-compose.yml`, a new compose service, `participants.json`, the dashboard's `deployment/dashboard/config.json`, and (for providers) a `seed-<name>.sh`. The FC picks up new `participants.json` entries automatically; the dashboard config is volume-mounted (browser refresh suffices), but key/Vault changes require `down -v` + `up --build`.

### REED Dashboard (`services/reed-dashboard/`)
A custom **React + Vite + TypeScript** SPA (served by nginx on `:8080`) that replaced the upstream Angular DataDashboard (which was slow to build and targeted the pre-0.17.0 catalog API). It is a browser-side app: it calls the REED backend (`:8081`), the connectors (`:19193`/`:29193`) and the federated catalog (`:39193`) directly — all CORS-enabled (the backend's CORS is in `WebCorsConfig`). **All EDC `*/request` list endpoints (FC `catalogs/request`, connector `contractnegotiations/request`, `transferprocesses/request`) require a `QuerySpec` body (`@type:QuerySpec, offset, limit`) — a bare `@context` fails JSON-LD expansion with a 400.** Endpoints are read at runtime from `/config.json` (bind-mounted from `deployment/dashboard/config.json`), so changing hosts/ports needs no rebuild. The old `fc-proxy` shim was removed (it only existed for the Angular client). Views: Overview, Matrix, Catalogue (discoverability by BPN), **Negotiate** (runs the full catalog→negotiate→EDR→pull flow in-browser via the consumer Management API; needs `provider.dspUrl` = the in-cluster DSP address), Policies (faithful ODRL), EDC Catalog (FC), Transfers, Audit (live). User guide: `docs/dashboard-guide.md`.
