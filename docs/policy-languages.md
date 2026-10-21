# Data-sharing policy: ODRL, CEL and OPA in REED

This report covers four things: what REED already uses to express and enforce data-sharing policy,
what it does not enforce yet, how [CEL](https://cel.dev) could close those gaps outside the
connector, and why CEL fits REED better than [OPA](https://www.openpolicyagent.org). It is a report
only: nothing here is built yet.

## 1. Short answer

- **ODRL is the language, and REED already uses it.** Gaia-X requires W3C ODRL combined with an
  ecosystem ontology ([glossary 25.11](https://docs.gaia-x.eu/glossary/25.11/odrl/),
  Architecture Document 25.11 §6.8.3). The Dataspace Protocol (DSP) carries ODRL offers and
  agreements, and every EDC policy definition is ODRL. Choosing ODRL is therefore not optional, and
  REED's templates already follow it.
- **CEL is an engine, and REED already runs it.** Inside every connector, ODRL constraints are
  evaluated by CEL expressions that REED registers (`/v5beta/celexpressions`).
- **OPA would be a second engine** doing the same job as CEL. EDC 0.17 has no OPA integration, so
  using OPA would mean writing a custom connector extension, running an extra service and
  translating ODRL into Rego.
- **Recommendation:** keep ODRL as the policy language and use CEL at both enforcement points: inside
  the connector (already done) and at the pull-time usage decision (`/reed/usage/decide`, not done
  yet).

## 2. What the code does today

REED policy has three layers. They map onto EDC as follows (see also
[identity-and-trust.md](identity-and-trust.md#how-the-reed-policy-layers-map-onto-edc)):

| Layer | When | What is checked | Who enforces it | Code |
|---|---|---|---|---|
| Catalogue (access policy) | catalog request | consortium → `MembershipCredential eq active`; bilateral → `SupplierRelationCredential.partner eq <owner>`; project → `SupplierRelationCredential.project eq <owner>` | the owner's connector, using CEL | `EdcRenderService.accessConstraints` (`services/reed-backend/.../edc/EdcRenderService.java:142-151`) |
| Contract (contract policy) | negotiation and transfer start | the template's **credential** constraints only, e.g. `oem-only` → `MembershipCredential.role eq OEM` | the owner's connector, using CEL | `EdcRenderService.contractConstraints` (`:154-174`) |
| Usage | each pull from the owner's data service | (1) a contract agreement exists for the asset and consumer; (2) a pilot licence is under 30 days old | REED backend, in hand-written Java | `UsageController.decide` (`usage/UsageController.java:80-126`), `Licence` (`usage/Licence.java`) |

A pull follows this path:

1. The consumer's connector pulls through the owner's data plane, which runs `http-pull-proxy`.
2. The proxy verifies the EDR and forwards `X-Edc-Consumer` (`HttpPullProxyExtension.java:164`) to
   the owner's data service (`services/data-service/server.py`).
3. The data service calls `/reed/usage/decide`.
4. If the decision allows it, the data service releases the payload stamped with `_reedLicense` and
   an HMAC watermark. Every decision, allowed or denied, is recorded as a `PULL` audit event.

## 3. How ODRL is used today

**Templates.** The six ODRL templates are seeded in `seed/DataSeeder.java:99-131`. Each asset class
is given a default template by the classification matrix at `:138-145`, for example
`ProductionStatus → project / time-limited-pilot-access`. Placeholders such as `$OWNER_BPN` and
`$EXPIRY` are filled in by `policy/PolicyTemplateRenderer.java:38-50`.

| Template | Permission | Prohibition | Obligation |
|---|---|---|---|
| `consortium-only` | use, if `MembershipCredential eq active` | – | `reed:audit` |
| `bilateral-supplier` | use, if `SupplierRelationCredential.partner eq $OWNER_BPN` | distribute | `reed:audit` |
| `dpp-read-only` | **read**, if `MembershipCredential eq active` | distribute, modify | `reed:audit` |
| `oem-only` | use, if `MembershipCredential.role eq OEM` | distribute | `reed:audit` |
| `time-limited-pilot-access` | use, if `SupplierRelationCredential.project eq $OWNER_BPN` **and** `odrl:dateTime lteq $EXPIRY` | distribute | **delete** when `odrl:dateTime gt $EXPIRY` |
| `simulation-service-only` | use, if `MembershipCredential.role eq SERVICE` | distribute, derive | `reed:audit` |

**Rendering to EDC.** `EdcRenderService` turns each template into an EDC `PolicyDefinition`. It keeps
only the permission constraints whose left operand is one of the five credential operands
(`CREDENTIAL_OPERANDS`, `:54-57`). If none is left, it falls back to `MembershipCredential eq active`.
For `oem-only` the rendered definition is:

```json
{"@context": ["https://w3id.org/edc/connector/management/v2"], "@type": "PolicyDefinition",
 "@id": "reed-policy-oem-only",
 "policy": {"@type": "Set",
   "permission": [{"action": "use", "constraint":
     {"leftOperand": "MembershipCredential.role", "operator": "eq", "rightOperand": "OEM"}}],
   "prohibition": [], "obligation": []}}
```

These policies use the `management/v2` context **without `@vocab`** (`:196-198`). With an `@vocab`,
an operand like `MembershipCredential.role` would be expanded into the EDC namespace and no CEL rule
would match it.

**The full template travels as metadata.** The complete template, including prohibitions and
obligations, is attached to each asset as the `reed:odrl` property (`:105-118`). Consumers can read
it, but nothing enforces it.

## 4. How CEL is used inside the connector

REED registers one CEL expression per credential left operand (`EdcRenderService.celExpressions`,
`:213-240`). `seed-reed.sh:30-41` posts them to every connector at `/v5beta/celexpressions`. Each
expression is bound to the scopes `catalog`, `contract.negotiation` and `transfer.process`. Here is
the one for `MembershipCredential.role`:

```text
('vc' in ctx.agent.claims ? ctx.agent.claims.vc : [])
  .filter(c, c.type.exists(t, t == 'MembershipCredential'))
  .exists(c, c.credentialSubject.exists(cs, cs.role == this.rightOperand))
```

The partner, project and certification checks match against comma-delimited claims, e.g.
`cs.partners.contains(',' + string(this.rightOperand) + ',')`.

**What a CEL expression can read in EDC 0.17.0.** This was checked against the `cel-core` 0.17.0
jar, which uses `dev.cel:cel:0.11.1`.

| Variable | Contents |
|---|---|
| `this` | the constraint: `{leftOperand, operator, rightOperand}`, where `operator` is the EDC enum name (`EQ`, `LEQ`, `GT`, `IS_ANY_OF` …) |
| `ctx.agent` | `{id, attributes, claims}`; `claims.vc` holds the requester's verified credentials (catalog, negotiation, transfer scopes) |
| `ctx.agreement` | `{id, assetId, providerId, consumerId, contractSigningDate}` (transfer and policy-monitor scopes) |
| `now` | the current time as a CEL `timestamp` |

`ctx` never contains the requester's *purpose* or the *action* it intends to perform. The connector
only knows who is asking, not what they will do with the data. That is why usage rules have to be
checked at pull time as well (§5).

**How a refusal shows up.**

- A requester that lacks a credential type the policy needs gets a DSP **401**.
- A requester whose credential has the wrong value gets a negotiation **TERMINATED**, with an
  `errorDetail` naming the constraint, e.g. `Constraint 'MembershipCredential.role' EQ 'OEM'`.

**EDC policy-engine behaviour that matters if more is added** (checked in `policy-engine-lib` and
`policy-evaluator-lib` 0.17.0):

- Any left operand can be given a CEL expression, including `odrl:dateTime` and `odrl:purpose`.
  Because the stored `leftOperand` is a plain string, the expression must use the full ODRL IRI.
- Policy validation is on by default (`edc.policy.validation.enabled=true`). Creating a policy fails
  if it uses an action or left operand that is not bound to any scope. The connector's JSON-LD
  context defines only the action `use`, so `read`, `distribute`, `delete` and the rest must be
  written `odrl:…` and bound somewhere.
- At evaluation, a rule whose action is not bound in the current scope is dropped together with its
  constraints. A prohibition with no constraints never fails.
- Contract agreements (`/v4/contractagreements/request`) carry the full agreed `policy`. Pull-time
  enforcement can therefore check what was actually agreed instead of today's template.

## 5. How CEL can be used outside the connector

Today `/reed/usage/decide` is hand-written Java. The proposal is to add the CEL library itself
(`dev.cel:cel`, the same 0.11.1 version EDC uses) to the backend, and have it evaluate the
**agreed** ODRL policy against a small input document:

```json
{"this": {"leftOperand": "...", "operator": "LEQ", "rightOperand": "..."},
 "ctx":  {"agent": {"id": "did:web:..."},
          "agreement": {"id": "...", "contractSigningDate": 1761000000},
          "request": {"action": "odrl:read", "purpose": "reed:production-monitoring"}},
 "now":  "2026-10-21T10:00:00Z"}
```

The variables are the same three EDC uses (`this`, `ctx`, `now`). REED could therefore keep **one map
of CEL rules per left operand**, registered on the connectors and also compiled in the backend. A
rule would then mean the same thing at negotiation and at pull. The two new rules would be:

```text
# odrl:dateTime - real expiry, checked at negotiation, transfer start and pull
this.operator == 'LEQ' ? now <= timestamp(string(this.rightOperand)) :
this.operator == 'LT'  ? now <  timestamp(string(this.rightOperand)) :
this.operator == 'GEQ' ? now >= timestamp(string(this.rightOperand)) :
this.operator == 'GT'  && now >  timestamp(string(this.rightOperand))

# odrl:purpose - a binding contract term at negotiation (no request in ctx),
# checked against the consumer's declared purpose at pull
!('request' in ctx) || ('purpose' in ctx.request &&
  ctx.request.purpose in (type(this.rightOperand) == list ? this.rightOperand : [this.rightOperand]))
```

How the input gets to the decision:

- **Purpose and action.** The consumer declares them on each pull, e.g.
  `?purpose=reed:production-monitoring&action=read`, with `read` as the default. `http-pull-proxy`
  already forwards query strings when the asset's data address sets `proxyQueryParams="true"`
  (today `EdcRenderService.java:128` sets `"false"`). The data service would pass both values
  through to `decide`.
- **Prohibitions.** Deny the request if its action is covered by a prohibition in the agreement,
  e.g. `distribute` under `oem-only`. Allow an action only if a permission covers it (`use` covers
  `read`), so `use` on a `dpp-read-only` asset is refused.
- **Obligations.** On the first allowed pull, record each obligation with its due date (from the
  obligation's `dateTime` constraint), e.g. `delete` after the pilot end. Show unfulfilled ones as
  *overdue* once the due date passes. `reed:audit` is met by the `PULL` audit event itself.

**What stays in Java.** Data-key authentication, the asset-ownership check, the agreement lookup on
the owner's connector, and the audit record. These are checks of identity and infrastructure, not
policy. CEL only answers "does this agreed policy allow this request now?"

## 6. Gaps today

| Gap | Where | Effect |
|---|---|---|
| `odrl:dateTime` is dropped from the EDC policy | `EdcRenderService.java:164` (only credential operands are kept) | an expired pilot can still negotiate and start transfers; it is refused only at pull |
| `$EXPIRY` is recomputed on every render | `PolicyTemplateRenderer.java:40` (`now + 30 days`) | the expiry shown in `reed:odrl` keeps moving forward |
| Pull-time expiry ignores the policy | `Licence.java:29-38`, `application.yaml:51-52` | expiry is computed as signing time + a global `pilot-days`, not from the agreed `rightOperand` |
| Prohibitions and obligations are not enforced | `Licence.java` copies them into the licence | `distribute`, `modify`, `derive` and `delete` are informational only |
| The action is always `use` | `EdcRenderService.java:191` | `dpp-read-only`'s `read` is lost |
| Agreed terms are not checked | `UsageController.java:114` renders the *current* template | if a template changes, an older agreement is judged by the new terms |
| No purpose constraint | anywhere | purpose cannot be expressed or enforced |
| The pilot path cannot be exercised | `deployment/roster.json` | the only `PROJECT_MEMBER` relation belongs to a participant without a connector, so no consumer qualifies for a `project` asset |

## 7. CEL vs OPA for REED

| | CEL | OPA / Rego |
|---|---|---|
| Already deployed | yes: in every connector (`edc-cel-core`, `edc-cel-api-v5`, `edc-dcp-cel`, `edc-cel-store-sql`) | no |
| EDC integration | native; expressions are stored in Postgres and managed through the Management API | none in EDC 0.17; needs a custom extension that registers rule functions and calls OPA over HTTPS |
| Extra service | none; it is a library in the connector and would be one in the backend | an `opa` container, with TLS, an authorisation policy for its own API, and monitoring |
| Network hop per decision | none | one HTTPS call per atomic constraint per scope (about 3 at negotiation and 3 more at transfer start) |
| Mapping from ODRL | one expression per left operand; the operator and right operand come straight from the ODRL constraint | the ODRL JSON must be translated or interpreted by a Rego module that mirrors the CEL rules |
| Same rule at both points | yes: the same expression strings run in EDC and in the backend | only if the connector also delegates to OPA, which means replacing EDC's CEL |
| Safety and cost | not Turing-complete, with bounded evaluation cost (nanoseconds to microseconds) | more expressive (recursion, data imports), so its cost depends on how the policy is written |
| Tooling | small; you test it with your own fixtures | strong: `opa test`, decision logs, bundles, a playground |
| Use outside the data space | narrow, as an embedded expression language | broad: one engine for APIs, Kubernetes and infrastructure policy |

**Why CEL fits REED.**

1. CEL already decides every catalog request, negotiation and transfer in the stack. Using it for
   pull-time decisions too means one engine, one rule set, and one place where a rule's meaning is
   defined.
2. ODRL constraints are already atomic (`leftOperand / operator / rightOperand`), and EDC's CEL binding
   evaluates exactly that shape. Nothing has to be translated.
3. OPA would add a service to the decision path of every negotiation, and a second copy of the rule
   logic in Rego that must be kept in step with Java.
4. Gaia-X specifies the policy *language* (ODRL), not the engine. Choosing CEL loses no compliance.

**When OPA would be worth it.**

- REED needed a single policy engine shared with systems outside the data space, e.g. API gateways
  or Kubernetes admission.
- Operators wanted central policy bundles and decision logs that are managed separately from the
  connectors.
- Policies grew beyond per-constraint checks into rules that need joins over external data.

None of these applies today.

## 8. Scenarios

All participants are the fictional companies in `deployment/roster.json`. The first three scenarios
are what `run-transfer.sh` proves today.

### A. Nordvind (OEM) obtains Castellum's ProcessCapability (`oem-only`): allowed

| Step | Layer | Engine and rule | Result |
|---|---|---|---|
| Catalog | access `reed-access-bilateral` | CEL `SupplierRelationCredential.partner` contains Castellum's BPN | offered |
| Negotiate | contract `reed-policy-oem-only` | CEL `MembershipCredential.role == 'OEM'` | FINALIZED |
| Transfer start | the same contract policy | the same CEL rule | EDR issued |
| Pull | usage | Java: agreement exists; not a pilot, so no expiry | payload released with `_reedLicense` and a watermark |

With CEL at pull time as well: the same result for `action=read` or `use`. A pull with
`action=distribute` would be refused, because `oem-only` prohibits it. Today the prohibition only
appears in the licence.

### B. Castellum (SUPPLIER) negotiates Wisła's ProcessCapability (`oem-only`): refused

The CEL rule `MembershipCredential.role == 'OEM'` is false for a SUPPLIER, so the negotiation is
TERMINATED with `Constraint 'MembershipCredential.role' EQ 'OEM'`. This is unchanged by the proposal.

### C. Hanse, with no supply relation to Nordvind, looks at Nordvind's BillOfMaterial: not visible

The access policy `SupplierRelationCredential.partner eq <Nordvind>` fails at catalog time, so the
asset is never offered. Discovery itself is governed by policy, which is the "discover only what
you may see" half of the REED invariant. This is unchanged by the proposal.

### D. A ProductionStatus pilot (`time-limited-pilot-access`): today vs CEL at both points

The consumer holds a `SupplierRelationCredential` whose `projects` lists the owner, and the
agreement includes `odrl:dateTime lteq <pilot end>`, prohibits `distribute`, and obliges `delete`
after the pilot end. Under the proposal it would also carry
`odrl:purpose isAnyOf [reed:production-monitoring, reed:capacity-planning]`.

| Situation | Today | With CEL at both points |
|---|---|---|
| Negotiate before the pilot end | FINALIZED (only the project credential is checked) | FINALIZED (credential and `now <= pilot end`) |
| Negotiate after the pilot end | **FINALIZED** (expiry is not in the EDC policy) | TERMINATED by the `odrl:dateTime` rule |
| Start a transfer on an old agreement after the end | allowed | TERMINATED by the same rule |
| Pull before the end with `purpose=reed:production-monitoring` | allowed | allowed |
| Pull with `purpose=marketing`, or no purpose | allowed | 403, `constraint odrl:purpose not satisfied` |
| Pull with `action=distribute` | allowed (prohibition is informational) | 403, `action distribute prohibited` |
| Pull after the agreed end | 403 only after signing + 30 days, whatever the agreement says | 403 at the agreed `rightOperand` |
| After the end, the `delete` obligation | not tracked | listed as *overdue* until the consumer confirms deletion |

Today this scenario cannot run end-to-end, because no connector participant has a `PROJECT_MEMBER`
relation (see §6). Adding one to the roster for a demo consumer would enable it.

## 9. If this is built later

A rough outline. Each step is small, and all of them stay on ODRL with CEL as the default engine.

1. **Templates.** Make them proper ODRL: give `odrl:dateTime` a fixed absolute pilot end instead of
   now + 30 days, add `odrl:purpose` to the pilot template, and keep real actions.
2. **`EdcRenderService`.** Render the full policy: real action, all constraints, prohibitions and
   obligations, written as `odrl:…`. Register the `odrl:dateTime` and `odrl:purpose` CEL rules
   alongside the five credential rules. Bind the usage-only actions so policy validation accepts
   them.
3. **Backend.** Add `dev.cel:cel` and evaluate the agreed policy from the contract agreement in
   `/reed/usage/decide`. `Licence` reads its expiry from the agreed `rightOperand`.
4. **Declared purpose and action.** Set `proxyQueryParams="true"` and have the data service pass
   `purpose` and `action` through to the decision.
5. **Obligations.** Add a `reed_obligation` table (Flyway migration), a way for the consumer to
   confirm deletion, and an *overdue* flag in the dashboard.
6. **Tests.** Shared ODRL fixtures run through the backend's CEL engine, plus a `run-policy.sh` that
   plays scenario D end-to-end.
7. **Optional OPA.** If wanted later, add a Rego module and a connector extension behind a
   `REED_POLICY_ENGINE=cel|opa` switch, run against the same fixtures. Static rule functions take
   precedence over CEL in EDC, so the two can be switched without clearing the CEL store.
