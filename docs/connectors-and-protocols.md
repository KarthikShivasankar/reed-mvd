# Connectors, communication & protocols

How the eight containers in the REED stack talk to each other — every port, every
endpoint, the protocols on the wire, and the use case behind each connection.

> This is the network reference behind the dashboard's topology diagram. For the
> *conceptual* flow (the six stages of a sovereign exchange) see
> [`dashboard-guide.md`](dashboard-guide.md) and
> [`../services/reed-dashboard/README.md`](../services/reed-dashboard/README.md).

---

## The eight containers

| Container | Image | Host ports | Role |
|---|---|---|---|
| **reed-dashboard** | nginx (built) | `8080` | Browser SPA. Calls the connectors, the FC and the REED backend directly (CORS-enabled). |
| **reed-backend** | Spring Boot (built) | `8081 → 8080` | REED **source of truth**: the 5 REED tables, the confidential submodels, the EDC render API, the catalogue/audit APIs. Persistent (Postgres). |
| **reed-provider** | EDC connector (built) | `19191-19195`, `19291` | The OEM's EDC connector — control plane + data plane collocated. Publishes offers, negotiates, serves payloads. |
| **consumer-1** | EDC connector (built) | `29191-29195`, `29291` | A partner's EDC connector. Discovers, negotiates, pulls. Same image as the provider, different mounted config. |
| **federated-catalog** | EDC FC (built) | `39191-39195` | Standalone crawler — aggregates participant catalogs into one queryable cache. No data plane. |
| **vault** | `hashicorp/vault:1.17` | `8200` | Dev-mode Vault holding the EC P-256 keys used to sign/verify EDR JWTs (ES256). |
| **init-vault** | `hashicorp/vault:1.17` | — (one-shot, **exits**) | Uploads the PEM key pairs from `deployment/vault/keys/` into `secret/<alias>`, then exits. Exited is **success**. |
| **postgres** | `postgres:16-alpine` | `5432` | Persistence for the **REED backend only**. EDC stores are in-memory. |

---

## Port convention

Every EDC participant gets a tens-digit prefix — **1x = reed-provider**, **2x = consumer-1**,
**3x = federated-catalog** — and a fixed suffix per web context:

| Suffix | Path | Web context | Who calls it | Protocol |
|---|---|---|---|---|
| `x191` | `/api` | **Default API** | health / misc | HTTP |
| `x192` | `/control` | **Data Plane Signaling API** | the control plane (internal) | REST (Signaling) |
| `x193` | `/management` | **Management API** | client apps: dashboard, `seed-reed.sh`, `run-transfer.sh` | REST + JSON-LD |
| `x194` | `/protocol` | **DSP** (Dataspace Protocol) | *other connectors* + the FC crawler | DSP over HTTP (JSON-LD) |
| `x195` | `/version` | **Version API** | tooling | HTTP |
| `x291` | `/public` | **Data Plane Public API** (the `http-pull-proxy` extension) | the *consumer* pulling a payload | HTTP + EDR JWT |

So `19193` = provider Management, `29194` = consumer DSP, `19291` = provider public data
plane, and so on. The federated catalog has **no** `x291` — it only crawls, it never serves
a payload. The DSP path is versioned: `/protocol/2025-1`.

---

## The protocols, and what each is for

### 1. DSP — Dataspace Protocol (`/protocol/2025-1`, ports `x194`)
The **lingua franca between connectors**. Asynchronous, JSON-LD messages built on DCAT
(catalogs) and ODRL (policies). Used for three things:
- **Catalog requests** — "show me what you offer" (metadata only).
- **Contract negotiation** — the back-and-forth that ends in a `FINALIZED` agreement.
- **Transfer process** messages — request / start / suspend / terminate.

DSP is *connector-to-connector*; a human/app never speaks DSP directly. It does **not**
establish trust — that's the job of DCP (here stubbed by `iam-mock`).

### 2. EDC Management API (`/management/v3/*`, ports `x193`)
A **RESTful control interface** for a client app to drive **its own** connector. JSON-LD
bodies. Never expose it publicly. Key endpoints:

| Endpoint | Method | Use case |
|---|---|---|
| `/v3/assets`, `/v3/policydefinitions`, `/v3/contractdefinitions` | POST | the **provider publishes** offers (run by `seed-reed.sh`) |
| `/v3/catalog/request` | POST | fetch a **point-to-point** catalog from one named provider over DSP |
| `/v3/catalogs/request` *(FC only, plural)* | POST | query the **aggregated** federated catalog cache |
| `/v3/contractnegotiations` | POST | start a negotiation; `/{id}` GET to poll for `FINALIZED` |
| `/v3/contractnegotiations/request` | POST | list negotiations (needs a `QuerySpec` body) |
| `/v3/transferprocesses` | POST | start an `HttpData-PULL` transfer; `/{id}` GET to poll for `STARTED` |
| `/v3/transferprocesses/request` | POST | list transfers (needs a `QuerySpec` body) |
| `/v3/edrs/{transferId}/dataaddress` | GET | retrieve the **EDR** — `{ endpoint, authorization: <ES256 JWT> }` |

> All `*/request` list endpoints require a `QuerySpec` body
> (`{"@type":"QuerySpec","offset":0,"limit":…}`); a bare `@context` 400s on JSON-LD
> expansion.

### 3. Data Plane Signaling API (`/control`, ports `x192`)
How a **control plane directs its data plane(s)**. Here the planes are *collocated* in one
runtime, so this is internal. The control plane sends `START` (which, for a consumer-pull
transfer, yields the EDR), `SUSPEND`, `RESUME`, `TERMINATE`.

### 4. Data Plane Public API (`/public`, ports `x291`)
The actual **payload door**, provided by the custom `http-pull-proxy` extension (EDC 0.17.0
dropped the stock module). The consumer calls
`GET http://localhost:19291/public` with `Authorization: <EDR JWT>`. The provider data
plane **verifies the JWT**, resolves the source `DataAddress`, and reverse-proxies to the
REED backend submodel — forwarding the static `X-Api-Key` upstream auth. This is where the
confidential bytes finally flow.

### 5. Identity — `iam-mock` (no port of its own)
Production EDC uses **DCP + Identity Hub** (Web DIDs, Verifiable Credentials) for trust.
This experiment swaps that for `iam-mock`: **always-allow**, no verifiable BPN claim. That
is why the *enforced* EDC policies are permissive `Set` policies (negotiation always
finalizes) and REED enforces discoverability + audit itself. See
[`reed-data-model.md`](reed-data-model.md).

### 6. Vault HTTP API (`8200`)
Each connector fetches its EDR signing/verification keys by alias
(`edc.transfer.proxy.token.signer.privatekey.alias`) from `secret/<alias>`, authenticating
with the dev root token. **Without parseable keys the provider crashes on first transfer.**

### 7. REED backend REST (`8081 → 8080`, `/reed/*`)
Not an EDC component. Consumed by:
- the **browser** (dashboard) — `/reed/classifications`, `/reed/policy-templates`,
  `/reed/catalogue?bpn=`, `/reed/audit`;
- the provider's **data plane** (in-cluster `reed-backend:8080`) —
  `/reed/submodels/{assetId}` with `X-Api-Key`, the confidential payload upstream;
- `seed-reed.sh` — `/reed/edc/{assets|policydefinitions|contractdefinitions}` to *render*
  what gets pushed into the connector.

### 8. JDBC (`5432`)
`reed-backend → postgres`. Persists the 5 REED tables. The EDC connectors do **not** use
Postgres (in-memory stores), so a `down -v` wipes REED state + the Vault volume.

---

## Who talks to whom — the communication matrix

```
                       DSP (x194)                 DSP (x194)
        consumer-1  ───────────────►  reed-provider  ◄───────────────  federated-catalog
        (29xxx)     ◄───────────────  (19xxx)                          (39xxx) crawls both
                       DSP callbacks               participants.json
            │                              ▲   │
            │ pull EDR JWT (x291 /public)  │   │ submodel X-Api-Key
            └──────────────────────────────┘   ▼
                                          reed-backend (8081) ──JDBC──► postgres (5432)
            ▲          ▲           ▲           ▲
            │ REST     │ REST      │ REST/JSON-LD
        ┌───┴──────────┴───────────┴──────────────┐
        │              reed-dashboard (browser)     │
        └───────────────────────────────────────────┘
        connectors also ──► vault (8200) for EDR keys
```

| # | From → To | Port / path | Protocol | Use case |
|---|-----------|-------------|----------|----------|
| 1 | browser → **consumer-1** | `29193/management` | Management REST | drive the flow: catalog, negotiate, transfer, EDR (dashboard **Negotiate**) |
| 2 | `seed-reed.sh` → **reed-provider** | `19193/management` | Management REST | publish the 8 asset classes as offers (assets + policies + contract defs) |
| 3 | browser → **federated-catalog** | `39193/management` | Management REST | `catalogs/request` — the **EDC Catalog** tab |
| 4 | browser → **reed-backend** | `8081/reed/*` | REST/JSON | Overview, Matrix, Catalogue, Policies, Audit |
| 5 | **consumer-1** → **reed-provider** | `19194/protocol/2025-1` | **DSP** | catalog request, contract negotiation, transfer start |
| 6 | **reed-provider** → **consumer-1** | `29194/protocol/2025-1` | **DSP** | async DSP callbacks (negotiation / transfer state messages) |
| 7 | **federated-catalog** → provider & consumer | `x194/protocol/2025-1` | **DSP** | periodic catalog crawl (every 15s, from `participants.json`) |
| 8 | consumer side → **reed-provider** data plane | `19291/public` | HTTP + EDR JWT | **pull the confidential payload** after the EDR is issued |
| 9 | **reed-provider** data plane → **reed-backend** | `reed-backend:8080/reed/submodels/{id}` | HTTP + `X-Api-Key` | fetch the submodel the proxy streams back |
| 10 | control plane → data plane (collocated) | `x192/control` | Signaling REST | `START`/`SUSPEND`/`TERMINATE`; mint EDR for consumer-pull |
| 11 | each connector → **vault** | `8200` | Vault HTTP | load EDR signing / verification keys (ES256) |
| 12 | **reed-backend** → **postgres** | `5432` | JDBC | persist the 5 REED tables |

### URL rule that causes most bugs
- **connector-to-connector / FC-to-connector / provider-DP-to-backend** addresses resolve
  **inside Docker** → use the **service name** (`http://reed-provider:19194/protocol`,
  `http://reed-backend:8080/...`). This is why `participants.json` and
  `edc.dsp.callback.address` use service names.
- **browser / host-script** addresses → use **`localhost`** (the dashboard's
  `managementUrl`, and `edc.dataplane.api.public.baseurl=http://localhost:19291/public/`
  so the EDR endpoint handed back is reachable from the host).

---

## End-to-end, mapped to the wire

A single `run-transfer.sh` / dashboard **Negotiate** run exercises, in order:

1. **(2)** provider seeded via Management API (once, by `seed-reed.sh`).
2. **(7)** FC crawls both connectors over DSP and caches the catalogs.
3. **(5)** consumer asks the provider for its catalog over DSP → gets metadata + a contract offer.
4. **(5/6)** consumer opens a contract negotiation over DSP; both control planes exchange messages until `FINALIZED`.
5. **(5/6)** consumer starts an `HttpData-PULL` transfer over DSP; provider reaches `STARTED`.
6. **(10)** provider control plane signals its data plane, which mints an **EDR** (ES256 JWT, signed with a key from **(11)** Vault).
7. **(1)** consumer reads the EDR from its Management API.
8. **(8)** consumer calls the provider's public data plane with the EDR JWT.
9. **(9)** provider data plane verifies the JWT and fetches the confidential submodel from the REED backend (`X-Api-Key`), streaming it back — and the backend writes a `PULL` audit event.
