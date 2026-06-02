# The REED Data Model

REED is a domain-specific **manufacturing data space** for sovereign sharing of
sensitive data about bulky parts (process capability, fixtures, quality
evidence, simulation results, digital product passports, …). A partner can
discover that data *exists* without receiving the confidential payload until a
contract is accepted, and every access is policy-governed and audited.

This document describes the data model implemented by the `reed-backend`
service (`services/reed-backend/`). The backend is the **source of truth**: it
persists the REED tables in Postgres and *renders* the EDC assets/policies/
contract-definitions that `seed-reed.sh` pushes into the `reed-provider`
connector. Only metadata reaches the EDC catalogue; the confidential payload
stays in the submodel service until a contract is accepted.

## Persistence

Five additive tables are created automatically on backend startup
(`spring.jpa.hibernate.ddl-auto=update`) and seeded by
`org.example.reed.seed.DataSeeder`:

| Table | Purpose |
|---|---|
| `reed_asset_classification` | the classification matrix (one row per asset class) |
| `reed_policy_template` | named, reusable ODRL policy templates |
| `reed_supply_chain_relation` | directed BPN→BPN edges (OWNS / SUPPLIES / PROJECT_MEMBER) |
| `reed_access_request` | partner requests to negotiate access |
| `reed_audit_event` | append-only audit log (CLASSIFY / DISCOVER / REQUEST / NEGOTIATE / PULL) |

Submodel payloads (the confidential data) are **not** a table — they live in the
submodel service as JSON resources under
`services/reed-backend/src/main/resources/submodels/`, served only via an
EDR-gated pull.

## The eight asset classes

| Asset class | What it holds |
|---|---|
| PartDigitalTwin | Catalog/serialized/bulky part identity, BPN ownership, lifecycle state |
| BillOfMaterial | Parent/child part relationships, supplier links |
| DigitalProductPassport | Materials, recyclability, carbon footprint, compliance |
| ProcessCapability | Machine envelope, operations, tolerances, lead time |
| FixtureHandlingStrategy | Fixture design, lifting/handling constraints, setup |
| ProductionStatus | Capacity, order status, quality gates, delivery |
| QualityEvidence | Inspection reports, certificates, non-conformance |
| SimulationResult | Process simulation, energy use, risk/lead-time estimation |

One sample instance per class is seeded with id `<class-kebab>-001`
(e.g. `process-capability-001`).

## The default classification matrix (seeded)

| Asset class | Sensitivity | Discoverability | Default policy template |
|---|---|---|---|
| PartDigitalTwin | consortium | consortium | consortium-only |
| BillOfMaterial | confidential | bilateral | bilateral-supplier |
| DigitalProductPassport | consortium | consortium | dpp-read-only |
| ProcessCapability | confidential | bilateral | oem-only |
| FixtureHandlingStrategy | confidential | bilateral | bilateral-supplier |
| ProductionStatus | restricted | project | time-limited-pilot-access |
| QualityEvidence | regulated | bilateral | oem-only |
| SimulationResult | confidential | bilateral | simulation-service-only |

## The policy model (three layers)

| Layer | Question it answers | Enforced by |
|---|---|---|
| catalogue | Can a partner discover the metadata exists? | REED catalogue visibility (`/reed/catalogue?bpn=`) + EDC contract-definition access policy |
| contract | Can a partner negotiate access? | EDC/ODRL contract policy generated from a REED template |
| usage | What obligations/prohibitions attach to the data? | EDC usage policy (ODRL) + REED audit on every submodel pull |

### Catalogue visibility (`CatalogueService`)

- a BPN outside the consortium discovers nothing;
- `consortium` assets are discoverable by any consortium member;
- `bilateral` assets need a direct SUPPLIES/OWNS relation to the owner;
- `project` assets need a PROJECT_MEMBER relation to the owner.

### Demo BPNs (`org.example.reed.config.Bpns`)

| BPN | Role | Sees |
|---|---|---|
| `BPN-REED-OEM-0001` | OEM / owner (the reed-provider) | everything it owns |
| `BPN-REED-SUP-0002` | supplier (the `consumer-1` connector) | consortium + bilateral |
| `BPN-REED-SIM-0003` | simulation service | consortium + project |
| `BPN-REED-OUT-9999` | consortium member, no relation | consortium only |

## A note on enforcement under `iam-mock`

The demo uses `iam-mock`, which carries no verifiable BPN/role claim, so the
**EDC** connector cannot evaluate the BPN/role/time constraints in the rendered
ODRL. Two consequences, by design:

1. The EDC policy bodies that are actually registered are permissive `Set`
   policies, so contract negotiation reaches `FINALIZED`.
2. REED still generates the **faithful** ODRL (with the real constraints,
   prohibitions and obligations) — it is attached to each asset under the
   `reed:odrl` property and served from `/reed/policy-templates`. This is what a
   production DCP/IdentityHub deployment would enforce. In the meantime REED
   enforces discoverability and records access at its own catalogue/audit layer.

## REST API (port 8081 on the host, 8080 in-cluster)

| Method & path | Purpose |
|---|---|
| `GET /reed/classifications` | the classification matrix |
| `GET /reed/policy-templates` | the seeded policy templates (faithful ODRL) |
| `GET /reed/catalogue?bpn=<BPN>` | metadata discoverable by that BPN (+ DISCOVER audit) |
| `GET /reed/submodels/{assetId}` | confidential payload; requires `X-Api-Key` (+ PULL audit) |
| `GET /reed/edc/assets` | EDC asset payloads rendered from REED |
| `GET /reed/edc/policydefinitions` | EDC policy definitions rendered from REED |
| `GET /reed/edc/contractdefinitions` | EDC contract definitions rendered from REED |
| `GET /reed/access-requests`, `POST /reed/access-requests` | list / create access requests |
| `GET /reed/audit` | the append-only audit log (most recent first) |
