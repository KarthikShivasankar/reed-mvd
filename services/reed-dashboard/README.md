# REED Dashboard

A browser-based control surface for the **REED manufacturing data space**. It makes the
core REED invariant tangible — *you can discover that data exists, but you only receive
the confidential payload after a contract is accepted, and every access is audited* — and
lets you **run that exchange end-to-end for real** against the live connectors.

- **Stack:** React + Vite + TypeScript, served by nginx on `:8080`.
- **Talks directly to:** the REED backend (`:8081`), both EDC connectors
  (consumer `:29193`, provider `:19193`), and the federated catalog (`:39193`).
- **Config at runtime:** endpoints are read from `/config.json`
  (bind-mounted from `deployment/dashboard/config.json`) — change hosts/ports with a
  browser refresh, no rebuild.

> Bring the stack up first (see repo `RUN.md`), then `./seed-reed.sh`, then open
> **http://localhost:8080**.

---

## The six stages of a sovereign exchange

The diagram on the **Overview** and **Negotiate** tabs animates these stages. Each hop is
labelled with the connector and **plane** it happens on (control plane vs data plane).

| # | Stage | Where it happens | What actually happens | Wire calls | Policy layer |
|---|-------|------------------|-----------------------|-----------|--------------|
| 0 | **Publish** | provider control plane | The REED backend renders the OEM's asset classes into the provider's control plane as **offers — metadata + policy only, never the payload**. The federated catalog crawler scrapes that catalog into its aggregated cache. | `seed-reed.sh` → `POST /v3/assets`, `/v3/policydefinitions`, `/v3/contractdefinitions`; FC crawler → `POST /catalog/request` | renders all three layers from the REED tables |
| 1 | **Discover** | consumer control plane · DSP | The consumer's control plane requests the provider's DCAT catalog over DSP (or browses the federated catalog). It learns data **exists** — titles, classes, ODRL terms — but receives **no payload**. | consumer CP → `POST /v3/catalog/request`; REED check → `GET /reed/catalogue?bpn=…` | **catalogue layer** — discoverability by BPN + supply-chain graph |
| 2 | **Negotiate** | control plane ↔ control plane | The two control planes run an asynchronous DSP contract negotiation. Reaching **`FINALIZED`** means a contract agreement (ODRL, bound to the consumer's participant id) exists. No agreement → no data. | `POST /v3/contractnegotiations`; poll `GET /v3/contractnegotiations/{id}` → `FINALIZED` | **contract layer** — the EDC contract policy gates access |
| 3 | **Transfer** | consumer control plane · DSP | Using the agreement as a token, the consumer starts an **`HttpData-PULL`** transfer process. The provider reaches **`STARTED`** and signals its data plane. | `POST /v3/transferprocesses`; poll → `STARTED` | — |
| 4 | **EDR** | provider → consumer data plane | The provider data plane mints an **Endpoint Data Reference** — a short-lived **ES256 JWT** pointing at the provider's public data-plane proxy — into the consumer's EDR cache. This enforces "payload only after contract" on the wire. | `GET /v3/edrs/{transferId}/dataaddress` → `{ endpoint, authorization }` | — |
| 5 | **Pull payload** | data plane → REED backend | The consumer pulls with the EDR JWT. The provider data plane (`http-pull-proxy`) **verifies the token**, fetches the confidential submodel from the REED backend (`X-Api-Key`), and streams it back. Every pull writes an audit event. | `GET {edr.endpoint}` with `Authorization: <jwt>` → provider DP → `GET /reed/submodels/{assetId}` | **usage layer** — ODRL obligations + a `PULL` audit event |

**The three REED policy layers**, mapped onto the stages above:

1. **Catalogue layer** (stage 1) — *can you discover it exists?* Driven by the asset's
   discoverability (consortium / bilateral / project) and the supply-chain graph.
2. **Contract layer** (stage 2) — *can you negotiate access?* The EDC contract policy.
3. **Usage layer** (stage 5) — *what may you do, and it's logged.* ODRL
   obligations/prohibitions + a `PULL` audit event on every access.

> **iam-mock caveat.** The demo mocks identity, so the connector's *enforced* policy is
> permissive (negotiation always finalizes). The BPN/role/time constraints shown in
> **Policies** are the *faithful* terms a production DCP/IdentityHub would enforce; REED
> additionally enforces discoverability and logs every access itself.

---

## The tabs — role, content, and how each is used

The navigation is grouped: **Start** (Overview) · **Reference** (Matrix, Policies, EDC
Catalog) · the numbered **Workflow** (Catalogue ① → Negotiate ② → Transfers ③ → Audit ④).
Every tab carries an in-app **"What this view is for & how it's used"** explainer that
mirrors this section.

### Overview — *the map & control room* (start here)
- **Role:** the single picture of how a payload moves from the OEM to a partner without
  losing sovereignty.
- **Contains:** live counts (asset classes, policy templates, audit events, EDR-gated
  pulls); the **interactive topology diagram** (both connectors with control + data
  planes, the federated catalog, the REED backend); **runnable REED scenarios**; a
  **custom scenario builder**; a guided path; and system status.
- **How it's used:** press **▶** to walk the six stages, then pick a use case (or build
  your own) and **run it live** to watch a real contract → EDR → pull — or a denial —
  light up the diagram.

### Matrix — *the governance rulebook for the data*
- **Role:** how every asset class is classified before any sharing happens (the *classify*
  step that precedes stage 0).
- **Contains:** the 8 REED asset classes with their **sensitivity** (consortium →
  confidential → restricted → regulated) and **discoverability** (consortium / bilateral /
  project), and the **default policy template** applied to each.
- **How it's used:** reference. This matrix is the source of truth the REED backend
  renders into the connector. Read it to understand *why* an asset is shareable to a
  given partner.

### Policies — *the terms a consumer agrees to* (usage layer)
- **Role:** the faithful ODRL encoding who may use an asset and under what conditions.
- **Contains:** the 6 templates (`consortium-only`, `bilateral-supplier`,
  `dpp-read-only`, `oem-only`, `time-limited-pilot-access`, `simulation-service-only`)
  with their permissions, prohibitions (e.g. *no redistribution*), obligations (e.g.
  *audit*) and constraints (e.g. *pilot expiry*).
- **How it's used:** inspect before negotiating to see the terms being accepted.

### EDC Catalog — *the live EDC view of discovery*
- **Role:** exactly what a partner's connector crawls across the data space.
- **Contains:** datasets aggregated by the federated catalog crawler from every
  participant — **metadata only** — annotated with REED class / sensitivity /
  discoverability.
- **How it's used:** confirm what is published at the EDC level. If a freshly seeded asset
  is missing, wait one crawl cycle (~15s) and refresh.

### Catalogue ① — *discoverability by partner* (catalogue layer)
- **Role:** proves a partner can only *find* what it is entitled to find.
- **Contains:** the assets visible to a chosen **BPN**, driven by the supply-chain graph;
  each with sensitivity, discoverability, template and owner.
- **How it's used:** switch between Supplier / Simulation service / Outsider to watch
  bilateral/project assets appear and disappear. Each query is audited as a `DISCOVER`
  event. **Workflow step 1.**

### Negotiate ② — *run the sovereign exchange* (contract layer)
- **Role:** the interactive heart of the demo — negotiate a contract and pull the
  confidential payload.
- **Contains:** the provider's live offers; the **shared topology diagram driven live** as
  the flow runs; a step-by-step trace; and the retrieved payload.
- **How it's used:** pick an offer and click **negotiate & pull**. Watch the stages
  advance; the payload is unreachable until the contract finalizes. **Workflow step 2.**

### Transfers ③ — *the connector's record of agreements & data flows*
- **Role:** the EDC state behind the contract and transfer stages.
- **Contains:** contract negotiations (`FINALIZED`, …) and transfer processes
  (`STARTED`, …).
- **How it's used:** after negotiating, confirm the negotiation reached `FINALIZED` and
  the transfer reached `STARTED`. **Workflow step 3.**

### Audit ④ — *the accountability record*
- **Role:** append-only proof that every access was governed and logged.
- **Contains:** every `CLASSIFY` / `DISCOVER` / `NEGOTIATE` / `PULL` event (actor BPN,
  asset id, detail, timestamp), auto-refreshing every 3s.
- **How it's used:** verify the trail after a scenario — a `DISCOVER` for the query and a
  `PULL` for the payload. This closes the loop. **Workflow step 4.**

---

## Build your own REED scenario

On **Overview → Build your own REED scenario**, choose any **consumer BPN** and any
**asset**, then **▶ run custom**. The runner first does the real catalogue-layer check
(`GET /reed/catalogue?bpn=…`); if the asset is discoverable it proceeds through the full
contract → EDR → pull; otherwise it stops with a **denied** banner. This is how you
demonstrate both a grant and a block.

Examples (one-click presets in the builder):

| Consumer BPN | Asset | Expected outcome | Why |
|---|---|---|---|
| `BPN-REED-SUP-0002` | `process-capability-001` | **granted** | tier-1 supplier has a direct SUPPLIES relation to confidential, bilateral data |
| `BPN-REED-SUP-0002` | `digital-product-passport-001` | **granted** | any consortium member may read the consortium-visible DPP |
| `BPN-REED-SIM-0003` | `production-status-001` | **granted** | project partner under a time-limited pilot policy |
| `BPN-REED-OUT-9999` | `quality-evidence-001` | **denied** | outsider with no relation — regulated/bilateral data is never even discoverable |
| `BPN-REED-SIM-0003` | `process-capability-001` | **denied** | wrong relationship — the simulation partner has no SUPPLIES edge for this asset |

To add a **built-in** scenario chip (not just a custom run), append to the `SCENARIOS`
array in [`src/diagram.tsx`](src/diagram.tsx):

```ts
{
  id: "my-case",
  label: "Short chip label",
  consumer: "Human-readable partner name",
  consumerBpn: "BPN-REED-…",        // identity used for the catalogue-layer check
  asset: "some-asset-001",            // must be a seeded asset id (see Matrix)
  sensitivity: "confidential",        // consortium | confidential | restricted | regulated
  outcome: "granted",                 // your expectation (shown as a chip)
  story: "One or two sentences on who is asking and why.",
}
```

Asset ids follow `kebab(assetClass)-001` (e.g. `ProcessCapability` →
`process-capability-001`). The seeded set is visible on the **Matrix** tab.

---

## Developing

```bash
cd services/reed-dashboard
npm install
npm run dev      # vite dev server on :8080 (reads public/config.json)
npm run build    # tsc + vite build → dist/
```

Rebuild just the container after editing the source:

```bash
docker compose -f deployment/docker-compose.yml up --build -d dashboard
```

### Source map
| File | Responsibility |
|---|---|
| `src/App.tsx` | views, navigation, the Overview scenario runner |
| `src/diagram.tsx` | the interactive topology diagram, the six `STEPS`, and the `SCENARIOS` |
| `src/guide.tsx` | the in-UI per-tab explainers (`TAB_HELP`) |
| `src/api.ts` | REED + EDC client and the shared end-to-end `runReedFlow()` |
| `src/config.ts` | runtime config loader (`/config.json`) and fallback |
| `src/ui.tsx` | shared presentational primitives (panels, chips, JSON viewer) |
| `src/styles.css` | the industrial-HMI theme |

> All EDC `*/request` list endpoints require a `QuerySpec` body
> (`@type: QuerySpec, offset, limit`) — a bare `@context` fails JSON-LD expansion with a
> 400. See `api.ts`.

For the conceptual walkthrough and the CLI equivalents, see
[`docs/dashboard-guide.md`](../../docs/dashboard-guide.md) and the repo `README.md`.
