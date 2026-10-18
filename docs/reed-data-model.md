# The REED data model

The REED backend (`services/reed-backend/`) is the **source of truth** for the data space: the
member directory, every member's data assets, the supply-chain graph, matchmaking and the audit
trail. It renders the EDC assets, policies, contract definitions and CEL rules that
`seed-reed.sh` pushes into each member's connector, and the views the Issuer Service turns into
verifiable credentials. Only metadata reaches an EDC catalog; confidential payloads leave only
through a provider's data plane after a contract.

## Persistence

Postgres, schema owned by **Flyway** (`src/main/resources/db/migration/V1__reed_schema.sql`;
Hibernate only validates). Seeded on an empty database by `seed/DataSeeder.java` from
`deployment/roster.json` and `deployment/scenarios/matchmaking.json`.

| Table | Purpose |
|---|---|
| `reed_participant` | member directory: BPN, name, role, country/city, VAT id, location, quay/rail access, sectors, connector, DID, attested certifications, public capability claim (JSON) |
| `reed_asset` | one concrete asset per row: class, **owner**, sensitivity, discoverability, policy template, confidential payload (JSON) |
| `reed_asset_classification` | the classification matrix: defaults per asset class |
| `reed_policy_template` | named ODRL templates (permission constraints on credentials + usage duties) |
| `reed_supply_chain_relation` | BPN → BPN edges: `OWNS`, `SUPPLIES`, `PROJECT_MEMBER` |
| `reed_rfq` | requests for quotation (demand side of matchmaking) |
| `reed_match` | match lifecycle per RFQ and supplier, score snapshot, EDC agreement, delivery feedback |
| `reed_access_request` | requests to negotiate access |
| `reed_audit_event` | append-only audit: `CLASSIFY`, `DISCOVER`, `REQUEST`, `NEGOTIATE`, `PULL`, `MATCH`, `ASSIST` |
| views `vc_membership`, `vc_certification`, `vc_supplier_relation` | read by the Issuer Service to issue credentials (one row per holder DID) |

## Asset classes and the classification matrix

| Asset class | Holds | Sensitivity | Discoverability | Default template |
|---|---|---|---|---|
| PartDigitalTwin | part identity, ownership, lifecycle | consortium | consortium | consortium-only |
| BillOfMaterial | parent/child parts, supplier links | confidential | bilateral | bilateral-supplier |
| DigitalProductPassport | materials, recyclability, carbon footprint (ESPR) | consortium | consortium | dpp-read-only |
| ProcessCapability | machines, envelope, tolerances, free capacity, Cpk | confidential | bilateral | oem-only |
| FixtureHandlingStrategy | fixtures, lifting and handling | confidential | bilateral | bilateral-supplier |
| ProductionStatus | capacity, order status, quality gates | restricted | project | time-limited-pilot-access |
| QualityEvidence | inspection reports, certificates | regulated | bilateral | oem-only |
| SimulationResult | process simulation, energy, risk | confidential | bilateral | simulation-service-only |

Assets are instances owned by one member: `<class-kebab>-<connector>`, e.g.
`process-capability-castellum`, `bill-of-material-nordvind`. A supplier's `ProcessCapability` is
the detail behind its public capability claim; it is made **consortium-discoverable** (so buyers
can find and negotiate it during matchmaking) while its contract policy stays `oem-only`.

## The three policy layers

| Layer | Question | REED | EDC (enforced by the provider connector) |
|---|---|---|---|
| **Catalogue** | may this member know the asset exists? | `/reed/catalogue` - discoverability vs. the supply-chain graph | access policy per discoverability on the requester's credentials |
| **Contract** | may this member agree a contract for it? | the asset's policy template | contract policy: credential constraints, e.g. role OEM |
| **Usage** | what is allowed afterwards? | `reed:odrl` prohibitions/obligations + `PULL` audit events (actor: the owner; the consumer, as named by the owner's data plane from the verified EDR, in the detail) | - |

Templates (`DataSeeder`): `consortium-only` (membership), `bilateral-supplier` (supply relation
with the owner), `dpp-read-only` (membership, no modification), `oem-only` (role OEM),
`time-limited-pilot-access` (shared project, until expiry, delete afterwards),
`simulation-service-only` (role SERVICE, no derivation). See
[identity-and-trust.md](identity-and-trust.md) for how the operands are evaluated.

## REST API (all under `/reed`, bearer token unless noted)

| Endpoint | |
|---|---|
| `GET /me`, `GET /participants` | caller and member directory |
| `GET /catalogue[?bpn=]` | discoverable assets for the caller's organisation (`?bpn=` for the operator) |
| `GET /classifications`, `GET /policy-templates` | the model |
| `GET /rfqs`, `POST /rfqs`, `GET /rfqs/{id}` | RFQs (posting: role `buyer`) |
| `GET /rfqs/{id}/matches`, `GET /rfqs/{id}/partners` | ranking (full for the buyer), partner recommendations |
| `GET /opportunities`, `GET /matches` | supplier view, the caller's matches |
| `POST /rfqs/{id}/shortlist/{bpn}`, `POST /matches/{id}/accept\|decline\|confirm\|feedback` | lifecycle |
| `POST /assistant/rfq-draft\|explain/{rfqId}\|chat` | local-LLM assistant |
| `/connectors/{name}/**`, `/federated-catalog/**` | relay to EDC Management APIs |
| `GET /audit`, `GET/POST /access-requests` | audit trail, access requests |
| `GET /edc/{assets\|policydefinitions\|contractdefinitions}?owner=`, `GET /edc/celexpressions` | rendered EDC payloads (admin) |
| `GET /submodels/{assetId}` | **no token**: per-owner `X-Api-Key`, called by provider data planes |
| `GET /health`, `GET /scenarios` | **no token** |
