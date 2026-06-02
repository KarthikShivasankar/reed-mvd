# REED — A Manufacturing Data Space

REED is a domain-specific **manufacturing data space** for sovereign sharing of
sensitive data about bulky parts — process capability, fixtures, quality
evidence, simulation results, digital product passports (DPPs), and more.
Partners (OEMs, suppliers, service providers) can **discover that data exists
without receiving the confidential payload** until a contract is accepted, and
**every access is policy-governed and audited**.

It is built on **Eclipse Dataspace Connector (EDC) `v0.17.0`** plus a
**Spring Boot + Postgres REED backend**, orchestrated with `docker compose`. The
end-to-end flow:

1. The **REED backend** classifies data and publishes **metadata only** to the
   `reed-provider`'s catalog (asset + policy + contract definition).
2. A standalone **Federated Catalog** aggregates participant catalogs.
3. From the **Consumer** (a partner/supplier):
   - *discover* the provider through the federated catalog,
   - fetch a fresh catalog directly from the discovered provider,
   - negotiate a contract → FINALIZED,
   - start a transfer with `transferType=HttpData-PULL`,
   - receive an `EndpointDataReference` (EDR) in its EDR cache,
   - use the EDR JWT to pull the **confidential payload** from the provider's
     data-plane proxy, which fetches it from the REED submodel service.

The topology:

```
        ┌─────────────┐     ┌──────────────────────────────────────────┐
        │  Postgres   │◀────│ REED backend  :8081                       │
        └─────────────┘     │  • 5 REED tables (matrix, templates, …)   │
                            │  • submodel service (confidential payload) │
                            │  • EDC render API (assets/policies/cdefs)  │
                            └───────────────┬──────────────────────────┘
                                            │ (payload only via EDR)
                     ┌──────────────────────┴───────────────────────┐
                     │ Federated Catalog  :39193 /management         │  ← metadata only
                     └───────────────┬───────────────────────────────┘
                          crawls     │
                   ┌─────────────────┴─────────────────┐
                   ▼                                    ▼
        ┌──────────────────────┐   DSP / EDR   ┌──────────────────┐
        │ reed-provider (OEM)  │◀──────────────│ Consumer-1       │
        │ :19193 mgmt          │               │ :29193 mgmt      │
        │ :19194 DSP           │──────────────▶│ (EDR cache)      │
        │ :19291 public proxy  │     EDR        └──────────────────┘
        └──────────┬───────────┘
                   │ pulls submodel (X-Api-Key)
                   ▼
        ┌──────────────────────┐        ┌──────────────────┐
        │ REED backend submodel│        │ HashiCorp Vault  │
        │  /reed/submodels/...  │        │  (demo PEM keys) │
        └──────────────────────┘        └──────────────────┘

        ┌──────────────────┐
        │ REED Dashboard   │  browser → :8081/:19193/:29193/:39193
        │  :8080           │  (React + Vite SPA)
        └──────────────────┘
```

> ⚠️ **Experiment only.** Uses `iam-mock` for dataspace trust, a dev-mode
> Vault, and in-memory EDC stores (only the REED backend is persistent). No
> DCP/IdentityHub, no TLS. BPN/role/time policy constraints are rendered
> faithfully by REED but soft-enforced under `iam-mock` — see *Architecture
> notes*.

## The REED data model

See **`docs/reed-data-model.md`** for the full model: the five tables, the eight
asset classes, the seeded classification matrix, the policy templates, and the
three-layer (catalogue / contract / usage) policy model. In short:

- **Eight asset classes** — PartDigitalTwin, BillOfMaterial,
  DigitalProductPassport, ProcessCapability, FixtureHandlingStrategy,
  ProductionStatus, QualityEvidence, SimulationResult.
- **Classification matrix** — each class is seeded with a sensitivity, a
  discoverability (consortium / bilateral / project), and a default policy
  template.
- **Three policy layers** — *catalogue* (can a partner discover the metadata?),
  *contract* (can a partner negotiate?), *usage* (what obligations/prohibitions
  attach?).

## Project layout

```
reed/
├── build.gradle.kts, settings.gradle.kts, gradle.properties
├── gradle/libs.versions.toml            # pins EDC 0.17.0 + Spring Boot / Postgres
├── services/
│   ├── reed-backend/                    # Spring Boot + Postgres: REED source of truth
│   │   ├── src/main/java/org/example/reed/   # domain, repos, seeder, policy, edc, web
│   │   └── src/main/resources/submodels/     # the 8 confidential payloads
│   └── reed-dashboard/                  # React + Vite + TS SPA (served by nginx)
├── extensions/
│   ├── static-node-directory/           # loads participants.json into the FC crawler
│   └── http-pull-proxy/                 # EDR-authorized HTTP pull proxy on provider
├── launchers/
│   ├── connector/                       # reed-provider & consumer runtime image
│   └── federated-catalog/               # standalone FC runtime image
├── deployment/
│   ├── docker-compose.yml
│   ├── vault/keys/                       # P-256 PEMs loaded into Vault at init (gitignored)
│   ├── reed-provider/config.properties
│   ├── consumer-1/config.properties
│   ├── federated-catalog/{config.properties,participants.json}
│   ├── dashboard/config.json             # runtime endpoint config for the React dashboard
│   └── requests/                         # JSON payloads used by the demo scripts
├── seed-reed.sh                          # renders EDC payloads from REED → reed-provider
└── run-transfer.sh                       # FC-discovery → negotiate → EDR → pull → audit
```

## Prerequisites

- JDK 17+
- Docker 20.10+ with Compose v2
- `curl`, `jq`, and `openssl` (used once to generate demo keys under `deployment/vault/keys/`)

The P-256 PEM files under `deployment/vault/keys/` are gitignored and generated
for this demo, then uploaded to the dev Vault by the `init-vault` sidecar.
Generate them before the first run:

```bash
mkdir -p deployment/vault/keys
for p in reed-provider consumer-1; do
  openssl ecparam -name prime256v1 -genkey -noout -out deployment/vault/keys/$p-signing-key.pem
  openssl ec -in deployment/vault/keys/$p-signing-key.pem -pubout -out deployment/vault/keys/$p-verification-key.pem
done
```

## Build

```bash
./gradlew :launchers:connector:shadowJar :launchers:federated-catalog:shadowJar :services:reed-backend:bootJar
```

Produces `launchers/connector/build/libs/connector.jar`,
`launchers/federated-catalog/build/libs/federated-catalog.jar`, and
`services/reed-backend/build/libs/reed-backend.jar`. Each Dockerfile copies its
host-built jar, so this build must run before `docker compose build`.

## Start the stack

On the first run, Docker builds the connector images, the federated catalog, the
REED backend image, and the React dashboard (a quick Vite build).

```bash
docker compose -f deployment/docker-compose.yml up --build -d
```

| Service             | Host URL                                               | Purpose                                    |
|---------------------|--------------------------------------------------------|--------------------------------------------|
| postgres            | localhost:5432                                         | REED backend database                      |
| reed-backend        | http://localhost:8081/reed/classifications             | REED source of truth + submodel service    |
| vault               | http://localhost:8200                                  | HashiCorp Vault (dev mode)                 |
| reed-provider (mgmt)    | http://localhost:19193/management                  | REED Provider Management API               |
| reed-provider (DSP)     | http://localhost:19194/protocol/2025-1             | REED Provider dataspace endpoint (DSP 2025/1) |
| reed-provider (public)  | http://localhost:19291/public                      | EDR-authorized data-plane proxy            |
| consumer-1 (mgmt)       | http://localhost:29193/management                  | Consumer-1 Management API                  |
| consumer-1 (DSP)        | http://localhost:29194/protocol/2025-1             | Consumer-1 dataspace endpoint              |
| federated-catalog   | http://localhost:39193/management/v3/catalogs/request  | Federated catalog query API                |
| **dashboard**       | **http://localhost:8080**                              | REED Dashboard (React browser UI)          |

## 1. Seed the provider

```bash
./seed-reed.sh
```

This is idempotent (409 = already exists = success). It GETs the EDC payloads
**rendered by the REED backend** from the classification matrix
(`/reed/edc/assets`, `/reed/edc/policydefinitions`,
`/reed/edc/contractdefinitions`) and POSTs them to the `reed-provider`
Management API. Afterwards the provider offers all eight REED asset classes —
**metadata only**; the confidential payloads stay in the submodel service.

## 2. Query the catalogs

Directly from the consumer's Management API (point-to-point DSP catalog request):

```bash
curl -s -X POST http://localhost:29193/management/v3/catalog/request \
  -H 'Content-Type: application/json' \
  -d @deployment/requests/fetch-catalog.json | jq
```

From the standalone Federated Catalog (aggregated, cache-backed):

```bash
curl -s -X POST http://localhost:39193/management/v3/catalogs/request \
  -H 'Content-Type: application/json' \
  -d @deployment/requests/empty-query.json | jq
```

In EDC 0.17.0 the Federated Catalog query API is served under the Management API
context, hence `/management/v3/catalogs/request` (plural `catalogs`).

You can also see the **REED catalogue layer** (discoverability per BPN) directly:

```bash
# A supplier with a bilateral relation sees consortium + bilateral assets:
curl -s "http://localhost:8081/reed/catalogue?bpn=BPN-REED-SUP-0002" | jq
# A consortium member with no relation sees only consortium assets:
curl -s "http://localhost:8081/reed/catalogue?bpn=BPN-REED-OUT-9999" | jq
```

## 3. Run the full consumer-pull + EDR demo

```bash
./run-transfer.sh
```

It discovers the provider via the Federated Catalog, fetches a fresh offer for
`process-capability-001` (a confidential, bilateral ProcessCapability asset),
negotiates a contract to FINALIZED, starts an `HttpData-PULL` transfer, fetches
the EDR, pulls the confidential payload through the data-plane proxy, and finally
prints the matching **`PULL` audit event** from the REED backend — proving the
access was logged and only happened after the contract was accepted.

Expected payload (the ProcessCapability submodel):

```json
{
  "assetClass": "ProcessCapability",
  "machine": "Gantry welding cell GW-12",
  "envelopeMm": { "length": 6000, "width": 2500, "height": 2000 },
  "maxWorkpieceMassKg": 2000,
  "operations": ["MIG welding", "robotic grinding", "CMM inspection"],
  "tolerances": { "flatnessMm": 0.4, "positionMm": 0.2 },
  "leadTimeDays": 14,
  "cpk": 1.67
}
```

## Architecture notes

### REED backend is the source of truth

The `reed-backend` (Spring Boot + Postgres) owns the REED data model and renders
the EDC payloads. The connector's EDC stores stay in-memory and are repopulated
by `seed-reed.sh` after each restart. Each rendered asset's `dataAddress` is an
`HttpData` source pointing at `http://reed-backend:8080/reed/submodels/<id>`
with `authKey=X-Api-Key` / `authCode=<reed.api-key>`, so the data-plane proxy
authenticates to the submodel service. The payload is only reachable through a
valid EDR — i.e. **only after a contract is accepted**.

### Why a custom `http-pull-proxy` extension?

EDC `0.17.0` removed the `data-plane-public-api` module that historically
registered both the `HttpData` public endpoint generator and the proxy
controller on the provider side. `extensions/http-pull-proxy/` re-introduces it
in ~100 lines: it registers a `PublicEndpointGeneratorService` function for
`HttpData` and a JAX-RS `ProxyController` on the `public` web context that
authorizes incoming EDR JWTs via `DataPlaneAuthorizationService`, looks up the
source `DataAddress`, and reverse-proxies to the backend (honoring
`authKey`/`authCode` to forward the REED `X-Api-Key`).

### Role of HashiCorp Vault

Vault holds the EC P-256 private/public keys the data-plane uses to sign and
verify EDR JWTs (ES256). Connectors resolve them by alias
(`edc.transfer.proxy.token.signer.privatekey.alias` etc.). `init-vault` uploads
the PEMs from `deployment/vault/keys/`. Without real parseable keys the provider
crashes on first transfer (`JWSSigner cannot be generated...`).

### Policy enforcement under `iam-mock`

`iam-mock` carries no verifiable BPN/role claim, so the EDC connector cannot
evaluate REED's BPN/role/time constraints. By design:

1. the EDC policies actually registered are permissive `Set` policies, so
   negotiation reaches `FINALIZED`;
2. REED still renders the **faithful** constraint-bearing ODRL (attached to each
   asset as `reed:odrl`, served from `/reed/policy-templates`) — what a
   production DCP/IdentityHub deployment would enforce — and enforces
   discoverability + audit at the REED layer.

| API                                | Auth in this demo                         | Production replacement                                        |
|------------------------------------|-------------------------------------------|---------------------------------------------------------------|
| Management API (`:19193/management`) | open / anonymous                        | `tokenbased` (X-Api-Key) or `delegated` OAuth                 |
| DSP protocol (`:19194/protocol/2025-1`)   | `iam-mock` (always allow)         | DCP: DID + Verifiable Credentials via IdentityHub             |
| Data-plane public (`:19291/public`)       | **EDR JWT (ES256)** signed with Vault key, verified by the proxy controller | already production-shaped |
| REED submodel (`:8081/reed/submodels`)    | static `X-Api-Key` (in-cluster only) | mTLS / signed service token                                   |

## REED Dashboard

A purpose-built **React + Vite + TypeScript** single-page app
(`services/reed-dashboard/`), served by nginx at **http://localhost:8080**. It
replaces the upstream Angular DataDashboard — it builds in *seconds* (Vite)
rather than minutes (Angular clone + compile), and it is REED-aware. Views:

- **Overview** — live stats + the sovereign-sharing flow and system status.
- **Matrix** — the classification matrix (8 classes, sensitivity, discoverability, template).
- **Catalogue** — discoverability by partner BPN (the catalogue layer in action).
- **Negotiate** — run the full contract flow from the browser: pick an offered
  asset and click *negotiate & pull* to negotiate → FINALIZED → transfer → EDR →
  pull the confidential payload, with a live step trace.
- **Policies** — the faithful ODRL each policy template renders.
- **EDC Catalog** — live datasets aggregated by the federated catalog (metadata only).
- **Transfers** — `consumer-1`'s contract negotiations and transfer processes.
- **Audit** — the append-only audit log, auto-refreshing every 3s.

**📖 See [`docs/dashboard-guide.md`](docs/dashboard-guide.md)** for what each
concept means and a step-by-step manufacturing supply-chain negotiation walkthrough.

The app is a browser-side SPA: requests go from your browser directly to the
REED backend (`:8081`), the connectors (`:19193`/`:29193`) and the federated
catalog (`:39193`) — all of which have CORS enabled. Endpoints are read at
runtime from `/config.json` (bind-mounted from
`deployment/dashboard/config.json`), so they can be changed without rebuilding.

### Rebuild the dashboard image

```bash
docker compose -f deployment/docker-compose.yml up --build -d dashboard
```

## Teardown

```bash
docker compose -f deployment/docker-compose.yml down -v
```

`-v` drops both the Vault and the Postgres volumes.

## Next steps

- **Real DCP / IdentityHub**: swap `iam-mock` for the DCP BOMs + an IdentityHub
  per participant + an Issuer Service, so REED's BPN/role/time ODRL constraints
  are enforced at the DSP layer. See the upstream
  [EDC MinimumViableDataspace](https://github.com/eclipse-edc/MinimumViableDataspace).
- **Persistent EDC state**: add EDC's SQL BOMs so connectors survive restarts
  without re-seeding (the REED backend is already on Postgres).
- **More participants**: see `docs/add-participant.md`. Append to
  `deployment/federated-catalog/participants.json` and the dashboard config.
- **Management API auth**: set `web.http.management.auth.type=tokenbased` and
  `edc.api.auth.key=...` in each connector's `config.properties`, then add
  `-H 'X-Api-Key: ...'` to the helper scripts.
