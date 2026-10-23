# Walkthrough: test REED by hand, and what happens underneath

A guided tour in seven parts. Each part has **steps** (what to click or type) and **under the hood**
(what actually happens: which component, which protocol, which check). The automated tests at the
end prove the same things without a browser.

Dashboard: **http://127.0.0.1:8088**, password for every demo user **`reed-demo`**. To switch user,
use *Log out* in the organisation badge (top right).

## 0. Start from a clean state

```bash
python3 tools/gen_topology.py                                   # roster -> compose, configs, realm, .env
docker compose -f deployment/docker-compose.yml down -v         # wipes Vault + Postgres
docker compose -f deployment/docker-compose.yml up --build -d
./seed-identity.sh && ./seed-reed.sh                            # DIDs + credentials, then EDC offers
docker compose -f deployment/docker-compose.yml ps              # everything Up / healthy
```

For the terminal checks below, load the helpers once per shell:

```bash
source tools/reed-lib.sh        # mgmt, token, api, catalog, negotiate, pull; loads deployment/.env
```

**Under the hood.** `gen_topology.py` turns `deployment/roster.json` into everything else:
7 EDC connectors (one per company), 8 IdentityHubs (one per identity), the Issuer Service, Vault
(a folder and token per identity), Postgres (one database per connector plus the REED registry),
Keycloak (realm, roles, demo users), Mosquitto (a password and ACL per factory line), the data
services and the factory simulators. `seed-identity.sh` creates each company's `did:web` DID in
its IdentityHub and has the issuer issue three credentials per member: Membership (role, country),
Certification and SupplierRelation. The issuer reads the claims from the registry's `vc_*` views.
`seed-reed.sh` asks the backend to render each owner's assets, policies, contract definitions and
CEL rules, then posts them to that owner's connector Management API. It upserts, so re-running it
updates what changed.

## 1. Who you are: identity and trust

**Steps**
1. Log in as `castellum-engineer`. The badge shows *Castellum*, Bilbao ES, roles
   `supplier-engineer` and `data-steward`. Open it: you see the verified certifications
   (ISO9001, DNV, PED) and the company's DID.
2. Open **Members**: the companies, which run a connector, verified versus self-declared
   certifications (`?`), and Komatsu labelled illustrative.

**Under the hood.** There are two separate identity systems:

- **People** log in with Keycloak (OIDC + PKCE). The access token carries `bpn` and `participant`
  (the company) and the realm roles. The backend takes the organisation **only from the token**,
  never from a request parameter.
- **Companies** prove themselves with DCP. When Castellum's connector calls another connector, it
  gets a self-issued token from its own IdentityHub's STS. The other side resolves Castellum's
  `did:web`, fetches a verifiable presentation of its credentials from Castellum's IdentityHub,
  checks the issuer's signature and revocation status, and evaluates its policies against the
  claims.

```bash
# the token a dashboard user carries
token castellum-engineer | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | jq '{bpn, participant, roles: .realm_access.roles}'
# the claims a company's credentials carry (what every connector checks)
api "$(token castellum-engineer)" GET /reed/policy/inbound | jq .claims
```

## 2. My data, my terms: an owner sets policy, the other side's connector enforces it

**Steps**
1. As `castellum-engineer`, open **Data space → My data, my terms**. The board has one row per
   company and one column per Castellum asset. Each cell has two lamps: **◉ finds it** and
   **✓ gets a contract** (✕ = refused, ○ = hidden). Hover a cell for the reason.
2. Click the **Process Capability** column. On the right, Nordvind, Hanse and Komatsu get a
   contract (`oem-only`, they are OEMs). Wisła, Maasvlakte and Rhein NDT are refused:
   *role SUPPLIER/SERVICE, but the policy needs role OEM*.
3. Change *Contract terms* to **`eu-member-states`**. The column turns dashed (a preview) and
   **nothing is published yet**. Nordvind turns ✕: *registered in NO, but the policy needs a
   registered seat in the EU*. Norway is in the EEA but not the EU. The others turn ✓.
4. Click **Publish to my connector**. A toast reports the publish and how many companies' access
   changed, and the changed lamps flash.
5. Log out, log in as `nordvind-buyer` → **Data space → What I can get**. Castellum's Process
   Capability now says *Castellum will refuse: registered in NO…*. Click **Try anyway**: after a
   few seconds Castellum's **connector** refuses with `MembershipCredential.country IS_ANY_OF …`.
6. Log back in as `castellum-engineer` and set the asset back to **`oem-only`** → Publish
   (`run-transfer.sh` expects these terms).

**Under the hood.**

- *Preview* calls `GET /reed/policy/preview`. `PolicyEvaluator`, a pure Java mirror of the
  connectors' CEL rules, evaluates the constraints against every company's claims from the same
  `vc_*` views the issuer issues from. Nothing leaves REED.
- *Publish* calls `PUT /reed/assets/{id}/policy`. It is allowed only for a user of the owning
  company with the `data-steward` role. Another company's asset answers 404, like a missing one.
  `PolicyService` stores the terms, then `EdcRenderService` renders them and REED pushes them to
  **Castellum's own connector** (POST, or PUT on 409):
  - the access policy for the discoverability;
  - the contract policy for the template;
  - the asset, carrying its faithful ODRL in `reed:odrl`;
  - the contract definition linking them.

  A `POLICY` audit event records who changed what.
- *Try anyway* runs from Nordvind's connector, through the REED relay, which allows only certain
  Management API calls:
  1. DSP catalog request to Castellum: its credentials are presented and the access policy passes.
  2. Contract request with the offer echoed back verbatim.
  3. Castellum's connector evaluates the contract policy in the `contract.negotiation` scope. The
     left operand `MembershipCredential.country` is bound to a CEL rule over the presented
     credentials:

     ```
     ctx.agent.claims.vc.filter(c, 'MembershipCredential' in c.type)
        .exists(c, c.credentialSubject.exists(cs,
            this.operator == 'IS_ANY_OF' ? (',' + rightOperand + ',').contains(',' + cs.country + ',') : …))
     ```

  4. `NO` is not in the list, so the negotiation is `TERMINATED` and its `errorDetail` names the
     constraint.
- Contracts already signed keep their old terms. Only the next catalogue request and negotiation
  see the new ones.

```bash
# what Castellum's connector now holds (the policy REED published)
mgmt castellum GET /v4/policydefinitions/reed-policy-eu-member-states | jq '.policy.permission'
# the CEL rules registered on every connector
mgmt castellum POST /v5beta/celexpressions/request "$QS" | jq -r '.[] | "\(.leftOperand)"'
# who changed terms
api "$(token reed-admin)" GET /reed/audit | jq '[.[] | select(.eventType=="POLICY")][:3]'
```

## 3. What I can get: discover, contract, receive a watermarked payload

**Steps**
1. As `castellum-engineer` → **Data space → What I can get**. The top panel shows what Castellum's
   connector proves about it: role SUPPLIER, registered in ES, ISO9001/DNV/PED, a supply relation
   with Nordvind and a shared project with Nordvind.
2. The list shows **only what Castellum may discover**. Nordvind's *Bill of Material* is there
   because Castellum supplies Nordvind. Assets Castellum may not discover are not listed at all.
3. Click **Get it** on *Bill of Material - Nordvind*. The button walks through the stages:
   catalogue → negotiating → contract agreed → transfer → token → payload. The result shows
   *Licensed to BPN-REED-SUP-0002*, the expiry, the prohibitions (`distribute`) and a watermark.
   Open *Whole payload* for the JSON.
4. Log in as `hanse-buyer` → *What I can get*: Nordvind's Bill of Material is **not listed**, since
   Hanse has no supply relation with Nordvind.
5. Open **Contracts**: the negotiation and the transfer on your own connector. Open **Audit**:
   the `PULL` event names the consumer and the verified agreement.

**Under the hood.** This is the invariant: *discover that data exists, receive the payload only
after a contract*.

1. **Catalogue.** Nordvind's connector answers Castellum's DSP catalog request. Each offer's
   **access policy** is evaluated, e.g. bilateral = `SupplierRelationCredential.partner eq
   <Nordvind BPN>`. Offers whose policy fails are simply left out.
2. **Contract.** The offer goes back verbatim. Nordvind's connector checks the contract policy and
   both sides store a contract agreement.
3. **Transfer.** The relay rebuilds the transfer request: `HttpData-PULL`, plus REED's own
   `transfer.process.started` callback, authenticated with Castellum's low-privilege callback key
   from its Vault folder. Caller-supplied callbacks are dropped. Castellum's connector delivers
   the endpoint data reference (EDR: endpoint + token) to REED, and the browser fetches it.
4. **Pull.** The browser calls Nordvind's data plane through the dashboard origin
   (`/dp/nordvind:19291/public/...`). The `http-pull-proxy` extension verifies the EDR token and
   calls **Nordvind's own data service** with Nordvind's data key and `X-Edc-Consumer`.
5. **Release.** The data service asks REED for a usage decision (`/reed/usage/decide`). REED
   checks that the consumer holds an agreement for this asset on **Nordvind's** connector and that
   a pilot licence has not expired, then audits a `PULL`. The data service stamps `_reedLicense`
   (licensee, agreement, expiry, duties) and an HMAC watermark over payload + licence.

REED itself never stores a payload.

## 4. Cross-border stories (EU vs EEA, competitors, certificates)

**Steps**
1. **Data space → Cross-border stories**: eight stories, each with the owner, the asset, the terms
   and the expected outcome per company (✓ contract, ✕ refused on a named credential, ○ hidden).
2. As the owner's data steward (e.g. `castellum-engineer` for X1/X2), click **Apply these terms**,
   then *Restore my terms* afterwards. As one of the requesting companies, click **Try it now** on
   your own row: it runs the real flow from your connector.
3. As `reed-admin`, click **Predict** on any story: REED's prediction appears next to each
   expectation.

| Story | Owner → asset | Terms | Result |
|---|---|---|---|
| X1 | Castellum (ES) capability | `eea-residency` | Nordvind (NO, EEA) ✓, Hanse ✓ |
| X2 | Castellum capability | `eu-member-states` | Nordvind ✕ on country, Hanse ✓ |
| X3 | Wisła (PL) capability | `no-competing-suppliers` | Castellum ✕ on role, Maasvlakte ✓, Hanse ✓ |
| X4 | Maasvlakte (NL) capability | `dnv-certified` | Nordvind ✕ on certification, Wisła ✓ |
| X5 | Rhein NDT (DE) evidence | `offshore-oem-eea` (3 constraints) | Hanse ✓, Nordvind ✕ DNV, Wisła ✕ role |
| X6 | Nordvind BOM | bilateral (current) | Castellum ✓ + pull, Hanse hidden |
| X7 | Castellum production status | project pilot (current) | Nordvind ✓ + live shop floor, Hanse hidden |
| X8 | Castellum capability | narrowed to bilateral | Hanse hidden, Nordvind ✓ |

**Automated:** `./run-interop.sh` (~5 min) does all of this against the real connectors:

- every connector × every other connector's catalogue must match the evaluator (7 × 6);
- one negotiation per company pair and distinct contract policy must match too (52 negotiations);
- the eight stories, with payload pulls;
- who may set terms.

Every changed term is restored. `SCENARIO=X2 ./run-interop.sh` runs one story.

## 5. The toy factory: a fault you inject becomes an alarm in real time

**Steps**
1. As `castellum-engineer` → **Factory**: the Bilbao demo casting line, three machines, six
   sensors, *live* LED, sparklines of the last hour, 24 h / 7 day history per sensor (click a tile).
2. Watch the MQTT traffic in a terminal:
   ```bash
   docker exec reed-mosquitto mosquitto_sub -u reed-backend -P "$MQTT_PASSWORD_REED_BACKEND" -v \
     -t 'reed/factory/castellum/control' -t 'reed/factory/castellum/alerts' -t 'reed/factory/castellum/observations'
   ```
3. **Line controls**: Machine *Fettling CNC*, Sensor *Spindle vibration*, **Inject spike**. The
   control command appears on MQTT, the tile's value jumps past 7.1 mm/s within 5 s, and within
   about a minute the tile turns **Alarm**, *Needs attention* lists it and an alert is published
   on `.../alerts`.
4. **Maintain Fettling CNC**: within one or two minutes the tile leaves Alarm. *Inject drift*
   instead walks a sensor past its limit in about 5 minutes, and you see the trend finding
   (*rising … reaches the limit in about N h*) before the alarm.
5. Write an observation, e.g. *Smoke under furnace 1, call me on +34 612 345 678*, then
   **Log observation**. The local LLM tags it (machine, category, severity, summary). The MQTT copy
   has no phone number and no author. **Brief me** joins the sensor findings and the notes into
   shift actions.
6. As `reed-admin` → Factory: read any line; the notes show summaries only, with no free text and
   no author. There are no controls, because the operator cannot steer a company's line.

**Under the hood.**
- **Simulator** (`services/factory-sim/sim.py`, one per factory company):
  - Each reading is nominal + daily swing + a wear ramp that resets each cycle + noise, published
    QoS 1 every 5 s to `reed/factory/<company>/<machine>/<sensor>`.
  - At start it backfills `.../history` from its last published time (7 days on first start).
  - It subscribes to `reed/factory/<company>/control`. A *spike* offsets the sensor 30 % past its
    limit; a *drift* ramps there over ~5 min; *maintain* clears the machine's faults and resets its
    wear for the cycle.
- **Broker** (Mosquitto): a password per client.
  - The ACL lets a device write only `<company>/+/+` and `<company>/+/+/history`, and read only
    `<company>/control`. Alerts and observations can only come from REED.
  - REED holds a persistent session (clean session off), so readings queue while it restarts.
- **REED** (`FactoryService`):
  - Stores readings in `reed_sensor_reading` (idempotent: primary key sensor + time).
  - Every minute, the pure `TrendAnalyzer` checks each sensor's last 1-minute average against its
    limits, a least-squares slope (hours to limit) and the z-score against the 7-day baseline.
  - A status change is published on `.../alerts` and pushed to the company's dashboards over
    server-sent events.
- `POST /reed/factory/control` is accepted only from the company's own people. It is checked
  against the roster's machines and sensors, then published and audited.

## 6. Live operations as a data product

**Steps**
1. As `nordvind-buyer` → **Data space → What I can get** → *Production Status - Castellum*
   (Nordvind and Castellum share an offshore-wind pilot project) → **Get it**.
2. The result shows the licence and **"Bilbao demo casting line, right now"**: each machine's
   status and its first finding. If you injected a fault in part 5, it shows here.
3. As `hanse-buyer`: Castellum's production status is not listed, because Hanse is not in the
   pilot.

**Under the hood.** The asset is project-scoped:
- access and contract policy: `SupplierRelationCredential.project eq <Castellum BPN>`;
- licence: `time-limited-pilot-access`, with an expiry in the licence.

When Castellum's data service asks for the usage decision, REED adds `shopFloor`
(`FactoryService.summary`) to its answer for this asset class. The data service puts it into the
payload **before** the watermark. So a customer sees Castellum's live line state only under a
contract, with a licence and an audit record.

## 7. Matchmaking, the operator, and the negative cases

**Matchmaking** (`nordvind-buyer`): **Matches → R1** rotor hub. The ranked suppliers have
per-criterion score bars (lead time, tolerance, logistics, track record, sector, CO2) and
filtered-out suppliers carry their reasons. Shortlist Castellum. As `castellum-engineer`,
**Opportunities → Accept**. Back as Nordvind, **Request capability via contract** runs the EDC flow
and confirms the match. `./run-matchmaking.sh` runs all 11 RFQs.

**The operator** (`reed-admin`): **Data space** → *Look as* any company. You see its board and
what it can get, but there is no Publish: only an owner sets its terms. *Cross-border stories →
Predict*.

**Negative cases to try**

| Who | Try | Expect |
|---|---|---|
| `nordvind-quality` (auditor, no `data-steward`) | change a Nordvind asset's terms | no Publish button; API 403 |
| `hanse-buyer` | `PUT /reed/assets/process-capability-castellum/policy` | 404, the same as a missing asset |
| `vagant-buyer` (not a member) | anything | no credentials: sees nothing, cannot post |
| `wisla-engineer` | Factory | only the Gdańsk cell; Castellum's sensors answer 404 |
| a device | publish on `reed/factory/castellum/alerts` | dropped by the broker ACL |

```bash
api "$(token hanse-buyer)" PUT /reed/assets/process-capability-castellum/policy \
  '{"discoverability":"consortium","policyTemplate":"consortium-only"}'; status   # 404
api "$(token nordvind-quality)" PUT /reed/assets/bill-of-material-nordvind/policy \
  '{"discoverability":"consortium","policyTemplate":"consortium-only"}'; status   # 403
```

## Automated tests

| Command | Proves | Time |
|---|---|---|
| `./gradlew :services:reed-backend:test` | scorer, scenario fixtures, assistant guardrails, `TrendAnalyzer`, `PolicyEvaluator`, licences | 1 min |
| `./run-transfer.sh` | DCP contract + EDR pull + watermark; 2 credential refusals; the relay cannot be abused | 1 min |
| `./run-matchmaking.sh` | 11 RFQs end to end, contract-backed confirm | 3 min |
| `./run-factory.sh` | MQTT auth + ACL, live stream, history, analysis, LLM tagging without personal data, briefing, scoping, spike → alarm → maintenance | 4 min |
| `./run-interop.sh` | every company pair's catalogue and contracts match the evaluator; 8 stories; who may set terms | 5 min |
| `./run-persistence.sh` | `down` + `up` with volumes kept: nothing needs re-seeding | 3 min |
| `cd services/reed-dashboard && npx playwright test` | 12 browser tests incl. owner publish → connector refusal, live Get it, toy-factory alarm | 3 min |

All print `PASS`/`FAIL` lines and exit non-zero on failure.

## Troubleshooting

- **Login loops or "backend did not answer"**: use `http://127.0.0.1:8088`, not `localhost`.
  Check `docker compose ps`; the backend needs Postgres, Keycloak and Mosquitto healthy.
- **Catalogue empty / every negotiation refused**: credentials not issued. Re-run
  `./seed-identity.sh`, which re-issues anything not ISSUED.
- **A changed role or roster user does not apply**: Keycloak imports the realm only into an empty
  database, so run `down -v` and seed again.
- **The assistant answers "rules"**: Ollama is not reachable at `host.docker.internal:11434`, or
  the route is a frontier model (shop-floor notes are tagged by a local model only). See README,
  *LLM routing*.
- **Factory tile stays "analysing"**: analysis runs every minute; the first run starts 20 s after
  the backend.
