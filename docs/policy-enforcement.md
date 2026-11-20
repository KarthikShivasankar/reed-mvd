# Policy-aware matchmaking, contracting and decentralised enforcement

REED Manufacturing-as-a-Service: a provider attaches a compound ODRL policy to a capability, REED
matches buyers against capability **and** policy, a contract freezes the effective policy, REED
translates it to Rego, and the provider's own Open Policy Agent (OPA) allows or denies every request
at the provider's connector.

Run it: `./run-policy.sh` (exit 0 = all PASS). Watch it: `node tools/demo-video/policy.mjs && python3 tools/demo-video/mix.py
tools/demo-video/out-policy` records a narrated six-step video (`out-policy/reed-policy.mp4`, local piper voice). Look at it: dashboard views **Capabilities**,
**Service RFQs**, **Service contracts**, **Operator**.

The policy exists at four separate moments, and each is a different piece of code:

| Moment | Who | What happens | Where |
|---|---|---|---|
| Design time | Provider | defines the policy and attaches it to a capability | `OfferingService`, view Capabilities |
| Matchmaking time | REED | asks its own OPA whether a buyer is eligible for an offering | `OfferingService.matches`, `reed-opa` |
| Contract time | Buyer + provider | the effective policy (offering policy AND buyer AND period AND purpose) is fixed | `ContractService.select` |
| Runtime | Provider's connector | its enforcement point asks its own OPA about a real request | `services/data-service`, `<name>-opa` |

Nothing here is a UI filter: the dashboard only shows what these four produce.

## 1. Architecture

```
Dashboard ── /reed ──> REED backend: control plane, policy information + administration point
                         ├ onboarding/   consortium management
                         ├ offering/     capability catalogue, OfferingMatcher (capability match)
                         ├ policy/odrl/  OdrlParser -> PolicyNode -> RegoMapper
                         ├ policy/opa/   OpaClient, PolicyDecisionService ───────────> reed-opa
                         ├ contract/     ContractService (lifecycle, deployment) ────> <provider>-opa
                         └ usage/        decide = request context, decisions = decision log

Consumer connector ─DSP─> Provider connector        (CEL over credentials: catalogue, negotiation)
   └ pull ─> provider data plane ─> <provider>-data  = policy enforcement point
                                       ├ 1 POST /reed/usage/decide       context (the OPA input)
                                       ├ 2 POST <provider>-opa /v1/data   ALLOW / DENY
                                       ├ 3 POST /reed/usage/decisions    decision log
                                       └ 4 payload only on ALLOW
```

REED never carries a payload and never takes the runtime decision. It supplies the facts about the
requester (so a consumer cannot claim to be an OEM) and the generated Rego; the provider's OPA
decides and the provider's data service enforces.

The eight concerns stay apart: business/catalogue (`offering/`, `domain/`), policy specification
(ODRL in `reed_policy_template`), compatibility checking (`OfferingService.matches` + OPA), contract
formation (`contract/`), transformation (`policy/odrl/`), runtime authorisation (OPA), data exchange
(EDC connectors + data service), auditing (`reed_policy_decision`, `reed_audit_event`).

## 2. Reused

`MatchScorer` and the part-RFQ flow (untouched), `ConnectorClient`, the connector relay,
`PolicyEvaluator` (the CEL mirror), `Licence` and watermark, `CurrentUser`, the EDC negotiation
and pull from the dashboard, the factory simulator (machine availability is the provider's live
shop-floor summary), `tools/reed-lib.sh`.

An offering's policy is stored as a `reed_policy_template` row named `offering-<id>` and the asset
behind the offering points at it. That one decision makes the existing machinery work for
offerings with no extra code: `EdcRenderService` renders the credential part as the connector's
CEL policy, the who-gets-what board and `/reed/policy/matrix` cover it, and `run-interop.sh`
verifies that REED and the connector agree.

## 3. Modified

| File | Change |
|---|---|
| `domain/Participant`, `Rfq`, `PolicyTemplate`, `EventType` | onboarding attributes; service-RFQ fields; policy as `text`; `ONBOARD`, `CONTRACT` |
| `edc/EdcRenderService` | constraints read through `OdrlParser` (explicit `and` as well as a plain array); `proxyQueryParams=true` so `?purpose=` reaches the data service |
| `usage/UsageController` | governed assets: returns the OPA context; new `POST /reed/usage/decisions` |
| `policy/PolicyService` | `publish(asset)` extracted; an offering's asset takes its terms from the offering |
| `match/MatchService`, `web/MatchController` | service RFQs are skipped by the part matcher |
| `seed/DataSeeder`, `participant/Roster` | attributes and offerings from the roster |
| `services/data-service/server.py` | enforcement point: ask own OPA, report, release only on ALLOW |
| `tools/gen_topology.py` | `<name>-opa` per connector, `reed-opa`, tokens, `deployment/opa/authz.rego` |
| dashboard `App.tsx`, `api.ts`, `DataViews.tsx`, `Marketplace.tsx`, `Matches.tsx` | navigation, client, decision log tab |

## 4. New

`policy/odrl/` (`PolicyNode`, `ConstraintKind`, `OdrlParser`, `RegoMapper`), `policy/opa/`
(`OpaClient`, `PolicyDecisionService`), `offering/` (`OfferingMatcher`, `OfferingService`,
`OfferingController`), `contract/` (`ContractService`, `ContractController`), `onboarding/`
(`OnboardingController`), `security/Members`, dashboard `views/Maas.tsx`, `run-policy.sh`,
roster company **Nordic Manufacturing Provider AS** (fictional; connector `nordic`, prefix 46,
simulated CNC cell).

## 5. Data model (`V7__maas_policy.sql`)

| Table | Columns added / created |
|---|---|
| `reed_participant` | `membership_status` (PENDING, ACTIVE, SUSPENDED), `verified`, `industry`, `competitor_classes` |
| `reed_rfq` | `capability`, `keywords`, `required_capacity`, `preferred_region`, `start_date`, `end_date`, `purpose` |
| `reed_offering` | id, provider, name, capability, resource kind + name, description, keywords, capacity, asset, policy template, published |
| `reed_contract` | id, RFQ, offering, provider, consumer, asset, start, expiry, purpose, `odrl`, `rego`, policy id, status, EDC agreement, deployed to/at |
| `reed_policy_decision` | time, stage, requester, provider, contract, offering, RFQ, asset, action, purpose, decision, policy id, decided by, conditions, failed, explanation |

How the onboarding attributes of the brief map:

| Attribute | Stored as |
|---|---|
| company id, name, country, industry | `bpn`, `name`, `country`, `industry` |
| organisation type, OEM/supplier | `role` (OEM, SUPPLIER, SERVICE) |
| EU/EEA status | derived from `country` |
| competitor classifications | `competitor_classes`; two companies sharing a class are competitors |
| consortium membership status | `membership_status` (`consortium` = ACTIVE, kept for the credential views) |
| trusted/verified | `verified` |
| bilateral relationships | `reed_supply_chain_relation` (existing) |
| connector id, endpoint, status | `connector_name`, `dsp_url`, live probe (`GET /reed/operator/connectors`) |

## 6. ODRL policy model

Supported subset: one permission, whose `constraint` is a single constraint, `{"and": [...]}`
(nested allowed) or a plain array (all must hold). `or`, `xone`, `andSequence`, `not`, an unknown
left operand or an operator a kind does not accept are **rejected with a message**: a policy REED
cannot translate must not look enforced.

| # | Brief | Left operand | Operators | Enforced by |
|---|---|---|---|---|
| 1, 2 | OEM-only, supplier-only | `MembershipCredential.role` | eq, neq, isAnyOf, isNoneOf | connector (CEL) + OPA |
| 3 | EU/EEA only | `MembershipCredential.country` | eq, neq, isAnyOf, isNoneOf | connector + OPA |
| 4 | consortium members | `MembershipCredential` = `active` | eq | connector + OPA |
| 5 | bilateral relationship | `SupplierRelationCredential.partner` | eq | connector + OPA |
| 6 | non-competing | `reed:competitor` = `false` | eq | OPA |
| 7 | time-limited | `odrl:dateTime` | gteq, lteq, gt, lt | OPA |
| 8 | pilot project only | `reed:pilotProject` = `true` | eq | OPA |
| 9 | specific buyer | `reed:consumer` | eq, neq, isAnyOf, isNoneOf | OPA |
| 10 | purpose of use | `odrl:purpose` | eq, neq, isAnyOf, isNoneOf | OPA |
| | certification, shared project | `CertificationCredential.certification`, `SupplierRelationCredential.project` | eq | connector + OPA |

Normalised model (`PolicyNode`): `All(children) | Any(children) | Not(child) | Atom(kind, operator,
values)`. The logical structure is explicit; `Any` and `Not` are part of the model so OR/NOT can be
added in the parser and the mapper without touching anything that stores or passes policies.

Adding a manufacturing-specific constraint is one entry in the `ConstraintKind` enum: left operand,
accepted operators, Rego statements, wording.

## 7. Example compound policy

The offering's policy (what the provider defined):

```json
{"@context": "http://www.w3.org/ns/odrl.jsonld", "@type": "Offer", "uid": "offering-precision-cnc-nordic",
 "assigner": "BPN-REED-SUP-0013",
 "permission": [{"action": "use", "target": "production-status-nordic", "constraint": {"and": [
   {"leftOperand": "MembershipCredential.role",    "operator": "eq",      "rightOperand": "OEM"},
   {"leftOperand": "MembershipCredential",         "operator": "eq",      "rightOperand": "active"},
   {"leftOperand": "MembershipCredential.country", "operator": "isAnyOf", "rightOperand": "AT,BE,…,IS,LI,NO"},
   {"leftOperand": "reed:competitor",              "operator": "eq",      "rightOperand": "false"},
   {"leftOperand": "reed:pilotProject",            "operator": "eq",      "rightOperand": "true"}]}}]}
```

The contract's effective policy is an ODRL `Agreement` with `assignee` and four more constraints
in the same `and`: `reed:consumer eq <buyer>`, `odrl:dateTime gteq <start>`, `odrl:dateTime lteq
<expiry>`, `odrl:purpose eq <purpose>`.

## 8. ODRL to Rego

```
ODRL (JSON) ─ OdrlParser ─> PolicyNode ─ RegoMapper ─> Rego module ─ OpaClient.deploy ─> OPA
```

- Each atom becomes one boolean rule `c<n>` with `default c<n> := false`: a missing input attribute
  fails the condition, it never passes it.
- Each atom is also one entry in `conditions` (id, kind, wording, outcome).
- ALLOW/DENY is derived from that list (`count(failed) == 0`), nowhere else.
- A module answers two questions: `eligibility` (the policy's own conditions; matchmaking) and
  `decision` (the same plus `c0`: an active REED contract covers the request; runtime). In a
  contract's module `c0` also checks the contract id.
- Values are written as quoted Rego strings; a value cannot leave its literal (tested).
- Active consortium membership is always one of the conditions, also when the provider's policy does
  not name it (`RegoMapper.enforced`): a provider cannot open its data to non-members by omission.

| Kind | Rego |
|---|---|
| organisation type | `input.requester.orgType == "OEM"` |
| membership | `input.requester.membership == "ACTIVE"` |
| region | `input.requester.country in {"AT", …}` |
| company identity | `input.requester.bpn == "BPN-…"` |
| competitor | `input.requester.competitor == false` |
| bilateral relationship | `input.requester.bilateral == true` |
| time | `time.parse_rfc3339_ns(input.now) <= time.parse_rfc3339_ns("…")` |
| purpose | `input.purpose == "pilot-evaluation"` |
| pilot | `input.contract.pilot == true` |
| none-of | `v := input.requester.orgType` then `not v in {…}` (bound first, so a missing attribute fails) |

## 9. Generated Rego (a real contract, shortened)

```rego
package reed.policy.p_c_fd6a6b6b

import rego.v1

default c1 := false

c1 if {
    input.requester.orgType == "OEM"
}

default c4 := false

c4 if {
    input.requester.competitor == false
}

default c8 := false

c8 if {
    time.parse_rfc3339_ns(input.now) <= time.parse_rfc3339_ns("2027-01-20T00:00:00Z")
}

default c9 := false

c9 if {
    input.purpose == "pilot-evaluation"
}

default c0 := false

c0 if {
    input.contract.id == "C-FD6A6B6B"
    input.contract.status == "ACTIVE"
}

conditions := [
    {"id": "c1", "kind": "ORG_TYPE", "label": "Requester is an OEM", "pass": c1},
    {"id": "c4", "kind": "COMPETITOR", "label": "Requester is not a competing organisation", "pass": c4},
    {"id": "c8", "kind": "TIME", "label": "Access is not after 2027-01-20T00:00:00Z", "pass": c8},
    {"id": "c9", "kind": "PURPOSE", "label": "Declared purpose is pilot-evaluation", "pass": c9},
]   # c2, c3, c5, c6, c7 left out here

contract_conditions := [
    {"id": "c0", "kind": "CONTRACT", "label": "An active REED contract covers this request", "pass": c0},
]

eligibility := result(conditions)

decision := result(array.concat(conditions, contract_conditions))

result(cs) := {
    "decision": verdict([c | some c in cs; not c.pass]),
    "policy": "C-FD6A6B6B",
    "conditions": cs,
    "failed": [c | some c in cs; not c.pass],
}

verdict(failed) := "ALLOW" if count(failed) == 0

verdict(failed) := "DENY" if count(failed) > 0
```

The full text of every policy is in the dashboard (Capabilities, Service contracts) and in
`GET /reed/offerings/{id}` / `GET /reed/contracts/{id}`.

## 10. OPA request and response

`POST http://nordic-opa:8181/v1/data/reed/policy/p_c_fd6a6b6b/decision`, `Authorization: Bearer <token>`

```json
{"input": {
  "requester": {"bpn": "BPN-REED-OEM-0002", "name": "Hanse Marine & Rail GmbH", "orgType": "OEM", "country": "DE",
                "eea": true, "membership": "ACTIVE", "verified": true, "competitor": false, "bilateral": false,
                "project": false, "certifications": ["DNV", "ISO9001"]},
  "provider": {"bpn": "BPN-REED-SUP-0013", "name": "Nordic Manufacturing Provider AS"},
  "contract": {"id": "C-FD6A6B6B", "status": "ACTIVE", "pilot": true},
  "capability": "precision-cnc-nordic", "asset": "production-status-nordic",
  "action": "use", "purpose": "resale", "now": "2026-11-20T21:02:11Z"}}
```

```json
{"result": {"decision": "DENY", "policy": "C-FD6A6B6B",
  "conditions": [{"id": "c1", "kind": "ORG_TYPE", "label": "Requester is an OEM", "pass": true}, "…"],
  "failed": [{"id": "c9", "kind": "PURPOSE", "label": "Declared purpose is pilot-evaluation", "pass": false}]}}
```

REED adds the sentence (`DENY - Declared purpose is pilot-evaluation ✗`) when it logs the decision.
Everything in `input.requester`, `input.contract` and `input.now` comes from REED's registry; the
only thing taken from the consumer's request is `purpose`. An answer counts as ALLOW only if OPA
says so, no condition failed and there is at least one condition.

Who may talk to an OPA (`deployment/opa/authz.rego`): REED with the deploy token (policies and
queries); the company's data service with the company's data key (decision queries only). No OPA
port is published to the host.

## 11. Connector enforcement workflow

1. **Publish**: the offering's Rego goes to `reed-opa` and to the provider's OPA; the asset behind
   it gets the credential part of the policy on the provider's connector (CEL).
2. **Contract ACTIVE**: the contract's Rego is deployed to the provider's OPA
   (`PUT /v1/policies/<id>`). OPA keeps policies in memory, so REED re-deploys a missing one the
   next time it is needed (a restart loses nothing).
3. **Request**: consumer connector -> provider data plane -> provider data service, with the
   consumer's DID from the verified access token and `?purpose=`.
4. **Context**: the data service calls `POST /reed/usage/decide`. REED checks the data key, asset
   ownership and the EDC agreement, then answers with the policy path and the OPA input.
5. **Decision**: the data service asks its company's OPA.
6. **Log**: the data service reports the result to `POST /reed/usage/decisions`.
7. **Enforce**: payload with licence and watermark on ALLOW; 403 with the failed conditions on
   DENY. OPA unreachable, or the decision not logged: 403 (no undecided and no unaudited exchange).

A consumer that negotiates directly at the connector (the credential check may pass) still gets
nothing: without a REED contract the offering's own policy is evaluated, and `c0` fails.

## 12. Matchmaking algorithm

For a service RFQ and every published offering of another active member:

1. **Capability match** (`OfferingMatcher`, pure, no score). Four named checks, all must hold:
   capability equals; every requested keyword appears in the offering; offered capacity >= requested;
   provider's country in the preferred region (EU, EEA, NORDIC or a country code).
2. **Policy eligibility**, only for capability matches: REED's OPA evaluates the offering's Rego
   (`eligibility`) with the buyer's attributes, the RFQ's purpose and its start date as `now`.
3. **Final eligible match** = capability match AND policy eligible.

The buyer sees all three per offering, with one line per check and per condition. Other companies
do not see who is eligible for someone else's RFQ.

## 13. Contract lifecycle

| Transition | Trigger | What happens |
|---|---|---|
| -> DRAFT | buyer selects an eligible offering | eligibility is asked again and logged; effective ODRL and Rego are generated |
| DRAFT -> NEGOTIATING | buyer accepts the terms | the two connectors negotiate (EDC, credentials) |
| NEGOTIATING -> AGREED | buyer hands in the agreement id | verified on the buyer's connector: right asset, right two parties |
| AGREED -> ACTIVE | automatic | Rego deployed to the provider's OPA |
| -> EXPIRED | the period is over | computed when read; `c0` and the time condition fail |
| -> TERMINATED | a party or the operator | `c0` fails from then on |

A contract needs a resource and a connector on both sides.

## 14. REST API

| Endpoint | Who |
|---|---|
| `POST /reed/onboarding`, `PUT /reed/onboarding/{bpn}`, `POST /reed/onboarding/{bpn}/status` | operator (`admin`) |
| `GET /reed/operator/connectors` | operator |
| `GET /reed/offerings`, `GET /reed/offerings/{id}` | members, operator |
| `POST /reed/offerings`, `PUT /reed/offerings/{id}/policy`, `POST /reed/offerings/{id}/publish` | the provider's `data-steward` |
| `POST /reed/policies/translate` | members (preview; stores nothing) |
| `POST /reed/service-rfqs` | `buyer` |
| `GET /reed/rfqs/{id}/service-matches` | the RFQ's buyer, operator |
| `POST /reed/contracts`, `POST /reed/contracts/{id}/accept`, `.../agreed` | the buyer |
| `POST /reed/contracts/{id}/activate`, `.../terminate`, `GET /reed/contracts[/{id}]` | the two parties, operator |
| `GET /reed/policy-decisions`, `POST /reed/policy-decisions/simulate` | own decisions; operator all |
| `POST /reed/usage/decide`, `POST /reed/usage/decisions` | a company's data service (data key) |

Someone else's offering draft or contract answers 404, like a missing one.

## 15. Dashboard

| View | Shows |
|---|---|
| Capabilities | catalogue; per offering the policy components, the effective combination, ODRL, Rego; register, compose a policy from ten kinds of condition, publish |
| Service RFQs | request form; per offering three columns: capability match, policy eligibility, final; "Select this provider" |
| Service contracts | status, terms, the policy lifecycle rail, accept and conclude, request the data (ALLOW/DENY), simulated request, decisions |
| Operator | members and onboarding, connectors and decision points with live status, capabilities and policies, RFQs and matches, contracts, decision log |
| Audit | new tab "Policy decisions" |

## 16. Audit model

`reed_policy_decision` holds one row per OPA decision: timestamp, requester, provider, contract,
asset and capability, requested action, declared purpose, decision, the policy evaluated, every
condition with its outcome, the failed conditions, the reason in words, the stage (MATCH, RUNTIME,
SIMULATED) and which OPA answered. Lifecycle events (onboarding, capability published, contract
states, policy deployed, payload released or denied) go to `reed_audit_event`. Organisations only,
never a person.

## 17. Sequence

```
Operator -> REED          onboard company, set attributes, approve                    ONBOARD
Nordic   -> REED          register capability + compound ODRL policy, publish        POLICY
REED     -> nordic        asset + CEL policy (credential conditions)
REED     -> reed-opa, nordic-opa   offering Rego
Hanse    -> REED          service RFQ (purpose pilot-evaluation)
REED     -> reed-opa      eligible?   Hanse ALLOW / Nordvind DENY (competitor)        MATCH
Hanse    -> REED          select provider -> contract DRAFT -> accept -> NEGOTIATING  CONTRACT
hanse   <-> nordic        DSP negotiation, credentials -> agreement
Hanse    -> REED          agreement id -> AGREED
REED     -> nordic-opa    contract Rego -> ACTIVE                                     CONTRACT
hanse    -> nordic data plane -> nordic-data (enforcement point)
nordic-data -> REED       decide: context
nordic-data -> nordic-opa decision                                                   RUNTIME
nordic-data -> REED       report
nordic-data -> hanse      machine availability (ALLOW)  |  403 + failed condition (DENY)   PULL
```

## 18. How it was built, and what is not in it

Order of implementation: policy core with unit tests -> roster and topology (OPA containers) ->
schema and seed -> OPA client and decision log -> matchmaking -> contracts -> runtime enforcement
-> onboarding -> dashboard -> `run-policy.sh`.

Not built, each a contained addition:

- OR and NOT (the model has them; parser and mapper reject them).
- Prohibitions and obligations in Rego (carried in the ODRL, shown in the licence, not enforced).
- Provisioning a connector at runtime. Onboarding registers a company and its attributes; its
  connector, IdentityHub and OPA are containers generated from the roster
  (`docs/add-participant.md`), and a new identity needs a fresh Vault.
- Credentials for the OPA-only attributes (competitor class, purpose). They come from REED's
  registry, so the connector's own CEL check cannot see them; OPA at the data service does.
- Revoking credentials on suspension. A suspended member keeps its credential until it is
  re-issued; the runtime decision denies it anyway.
