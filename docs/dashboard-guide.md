# REED Dashboard & Workflow Guide

This guide explains **what** the REED concepts are, **why** they exist, and
**how** to use the dashboard (http://localhost:8080) to drive a realistic
manufacturing supply-chain contract negotiation end to end.

> New here? Bring the stack up first with `RUN.md`, then `./seed-reed.sh`.

---

## 1. The concepts (and why they matter)

A **data space** lets companies share data **without giving up control of it**.
In manufacturing, an OEM and its suppliers must exchange sensitive things —
process capability, fixtures, quality evidence, simulation results, product
passports — but a supplier should only see what it's entitled to, only after
agreeing to terms, and every access must be traceable. REED implements that with
five moving parts:

| Concept | What it is | Why it exists | Where in the dashboard |
|---|---|---|---|
| **Service** | A running component: the EDC **connectors** (`reed-provider`, `consumer-1`), the **federated catalog**, and the **REED backend** (the data owner's system of record + submodel store). | Each participant runs its own connector; nobody gets direct database access to anyone else. | **Overview** → System status |
| **Asset** | A unit of shareable data (one of the 8 REED classes, e.g. `process-capability-001`). Its **metadata** is public; its **payload** is confidential. | Lets partners *find* that data exists without exposing the contents. | **Matrix**, **Catalogue**, **EDC Catalog** |
| **Catalog** | The list of assets a provider **offers** — metadata only. The *federated* catalog aggregates many providers. | Discovery. A partner browses offers the way you'd browse a parts catalog — no payload attached. | **EDC Catalog**, **Catalogue** |
| **Policy** | The **rules** attached to an offer, written in ODRL (permissions / prohibitions / obligations / constraints). REED renders them from named templates (`oem-only`, `bilateral-supplier`, `dpp-read-only`, …). | Encodes *who* may use the data and *under what terms* — the sovereignty part. | **Policies** |
| **Contract** | An **agreement** reached by negotiation between two connectors, binding an asset to a policy. Only once it's `FINALIZED` is access granted. | The gate. No contract → no data. It is the auditable “you agreed to these terms”. | **Negotiate**, **Transfers** |

Two more terms you'll see:

- **EDR (Endpoint Data Reference)** — a short-lived, signed token (ES256 JWT)
  the provider mints *after* a contract, authorizing exactly one pull. It is how
  “payload only after contract” is enforced at the wire level.
- **BPN (Business Partner Number)** — a participant's identity. REED uses it to
  decide **discoverability** (who can even see an offer).

### The three policy layers
REED governs access at three points, not one:

1. **Catalogue** — *can you discover it exists?* (driven by an asset's
   `discoverability`: consortium / bilateral / project, plus the supply-chain graph).
2. **Contract** — *can you negotiate access?* (the contract policy).
3. **Usage** — *what may you do with it, and it's logged.* (ODRL
   obligations/prohibitions + an audit event on every pull).

---

## 2. The dashboard, tab by tab

Open **http://localhost:8080**.

- **Overview** — headline counts (asset classes, policy templates, audit events,
  payload pulls), the sovereign-sharing flow, and a live status check of the
  backend/connectors/FC. Start here to confirm everything is up.
- **Matrix** — the seeded classification matrix: each of the 8 asset classes with
  its **sensitivity** (consortium → confidential → restricted → regulated, colour
  coded) and **discoverability**, and the **policy template** applied.
- **Catalogue** — the **catalogue layer** in action. Pick a partner **BPN** (or
  type one): the table shows only what that BPN may discover. Switch between
  *Supplier*, *Simulation service* and *Outsider* to watch bilateral/project
  assets appear and disappear. Each query is itself audited (a `DISCOVER` event).
- **Negotiate** — the interactive workflow (see §3). Pick an offered asset and
  click **negotiate & pull** to run a real contract negotiation from the browser.
- **Policies** — the six policy templates and the **faithful ODRL** REED renders
  for each (permissions, prohibitions like *no redistribution*, obligations like
  *audit*, and constraints like a pilot expiry date).
- **EDC Catalog** — the live datasets aggregated by the federated catalog —
  **metadata only**, annotated with their REED class/sensitivity. This is what a
  partner's connector actually crawls.
- **Transfers** — the `consumer-1` connector's **contract negotiations** and
  **transfer processes** with their EDC states (`FINALIZED`, `STARTED`, …).
- **Audit** — the append-only log, auto-refreshing every 3 s: `CLASSIFY`,
  `DISCOVER`, `NEGOTIATE`, `PULL`. This is the accountability record.

---

## 3. Walkthrough — a real manufacturing supply-chain negotiation

**Scenario.** An OEM (`reed-provider`, BPN `BPN-REED-OEM-0001`) builds a bulky
welded chassis frame. A **supplier** (`consumer-1`, BPN `BPN-REED-SUP-0002`)
needs the OEM's **process capability** data to confirm it can machine a mating
part to tolerance. That data is **confidential** and **bilateral** — visible only
to partners with a direct supply relationship. Here is the sovereign exchange.

### Step 0 — The OEM classifies & publishes (already seeded)
`./seed-reed.sh` rendered the OEM's 8 asset classes into the connector as offers.
Only metadata was published; the `process-capability-001` payload stays in the
REED submodel service.
→ **Matrix** shows `ProcessCapability = confidential / bilateral / oem-only`.

### Step 1 — Discovery (catalogue layer)
Go to **Catalogue** and select **Supplier (BPN-REED-SUP-0002)**. Because the
supplier has a SUPPLIES relation to the OEM, `ProcessCapability` is visible.
Now select **Outsider (BPN-REED-OUT-9999)** — it disappears (an outsider sees
only consortium assets). *This is the catalogue layer enforcing sovereignty.*

### Step 2 — Inspect the terms (policy)
Open **Policies** → `oem-only`. The ODRL says: permit *use* by the OEM partner,
**prohibit distribution**, **obligation: audit**. These are the terms the
supplier is agreeing to.

### Step 3 — Negotiate the contract
Go to **Negotiate**. The left panel lists the OEM's offers. Click
**negotiate & pull** on `process-capability-001`. Watch the trace advance:

```
fetch offer → negotiate → FINALIZED → transfer → STARTED → EDR → pull payload
```

What actually happens (mirrors `./run-transfer.sh`):
1. the consumer fetches a fresh **offer** for the asset;
2. it opens a **contract negotiation** with the provider over DSP;
3. the negotiation reaches **`FINALIZED`** → a contract agreement exists;
4. it starts an **`HttpData-PULL` transfer**, which reaches **`STARTED`**;
5. the provider issues an **EDR** (signed token) into the consumer's cache;
6. the consumer **pulls** the payload through the provider's data-plane proxy,
   which verifies the EDR and streams the confidential ProcessCapability data.

The right panel shows the retrieved **confidential payload** — the machine
envelope, tolerances, Cpk, lead time. *It was unreachable until the contract
finalized.*

### Step 4 — Confirm the trail (contract + usage layers)
- **Transfers** now lists the negotiation (`FINALIZED`) and the transfer
  (`STARTED`).
- **Audit** shows a fresh **`PULL`** event for `process-capability-001`. Every
  access is accounted for.

### Try the contrast
Run the same flow on `digital-product-passport-001` (consortium, `dpp-read-only`)
— any consortium member may pull it, read-only. Compare with a `bilateral` or
`project` asset to feel how discoverability and templates change who gets in.

---

## 4. Doing it from the CLI

Everything in §3 is also scriptable (and is what the dashboard calls under the
hood):

```bash
./seed-reed.sh                                  # publish the OEM's offers
ASSET_ID=process-capability-001 ./run-transfer.sh   # negotiate + pull (default asset)
ASSET_ID=digital-product-passport-001 ./run-transfer.sh

# Inspect the REED layer directly
curl -s "http://localhost:8081/reed/catalogue?bpn=BPN-REED-SUP-0002" | jq   # discoverability
curl -s  http://localhost:8081/reed/policy-templates | jq                    # faithful ODRL
curl -s  http://localhost:8081/reed/audit | jq                              # audit log
```

---

## 5. Notes & limits

- **iam-mock**: the demo's identity is mocked, so the connector's *enforced*
  policy is permissive (negotiation always finalizes). The BPN/role/time
  constraints you see in **Policies** are the *faithful* terms a production
  DCP/IdentityHub deployment would enforce; today REED also enforces
  discoverability and logs all access itself. (See `docs/reed-data-model.md`.)
- **Endpoints** are read from `deployment/dashboard/config.json` at runtime —
  edit it and hard-refresh to point the dashboard elsewhere; no rebuild.
- The browser can call the connectors and the data-plane proxy because CORS is
  enabled on the connectors and the REED backend.
