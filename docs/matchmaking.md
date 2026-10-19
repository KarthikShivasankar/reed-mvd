# Matchmaking in REED

REED connects **demand** (an OEM's request for quotation, RFQ) with **supply** (a member's
capability) across the data space, and explains every decision. Matching uses only data a
member may share consortium-wide; the confidential details behind a claim are exchanged later,
under an EDC contract.

## The two layers of capability data

| Layer | Where it lives | Who sees it | Used for |
|---|---|---|---|
| **Public capability claim** | `reed_participant.capability` (from `deployment/roster.json`) | every consortium member | ranking |
| **Confidential process capability** | the supplier's `ProcessCapability` asset (`process-capability-<connector>`), served by its data plane | only an OEM holding an EDC contract | confirming a match |
| **Verified certifications** | the REED registry (`attestations`), issued as `CertificationCredential` by the REED Issuer Service | every member; enforced by connectors | hard filters, EDC policies |
| **Self-declared certifications** | `capability.claimedCerts` | every member | shown with a `?`, **never** pass a hard filter |

## Scoring (`services/reed-backend/.../match/MatchScorer.java`)

`MatchScorer` is a pure function - no database, no clock - so the same inputs always give the
same ranking and the unit tests run without the stack.

### Hard filters (any failure removes the supplier, with a reason)

| Code | Rule |
|---|---|
| `PROCESS_MISSING` | every required process must be offered |
| `MATERIAL_UNSUPPORTED` | the RFQ material must be in the supplier's list |
| `ENVELOPE_TOO_SMALL` | the part must fit in **some** axis-aligned orientation: sort both size triples and compare |
| `MASS_EXCEEDED` | part mass ≤ supplier maximum |
| `TOLERANCE_NOT_MET` | supplier's best tolerance ≤ required tolerance |
| `LEAD_TIME_EXCEEDED` | lead time ≤ weeks until the due date |
| `CERT_NOT_VERIFIED` | every required certification must be **verified**; a self-declared one is reported as such |

### Weighted criteria (each normalised to 0..1, weights in `application.yaml`)

| Criterion | Weight | Score |
|---|---|---|
| Lead time & capacity | 0.20 | buffer `(weeks available - lead time) / weeks available` × capacity factor (LOW 0.6, MEDIUM 0.85, HIGH 1) |
| Tolerance margin | 0.15 | `1 - best tolerance / required tolerance` |
| Logistics | 0.20 | `1 - distance / 2500 km` (haversine to the delivery site); **bulky parts** (> 20 t or > 4 m) × 0.3 if the supplier has neither quay nor rail access |
| Track record | 0.15 | Laplace-smoothed share of good deliveries `(good + 1) / (n + 2)` from confirmed REED matches and feedback; a claim the confidential data contradicted counts as a bad delivery |
| Sector experience | 0.10 | 1 if active in the RFQ's sector, else 0.3 |
| Embedded CO2 (CBAM) | 0.20 | `(2.5 - kg CO2e per kg) / 2.1`, clamped; undeclared = 0.5 |

Ties are broken by track record, then distance, then BPN - fully deterministic. Every criterion
carries a one-line note ("14 of 40 weeks, capacity MEDIUM", "1845 km to delivery site; bulky
part, quay access") so the dashboard and the assistant can explain it.

### Three directions, one scorer

- **Suppliers for an RFQ** - `GET /reed/rfqs/{id}/matches`. The buyer (and the operator) sees the
  full ranking and every rejection; any other member sees only its own row.
- **Opportunities for a supplier** - `GET /reed/opportunities`: open RFQs the caller passes, with
  its own score.
- **Partners for the remaining steps** - `GET /reed/rfqs/{id}/partners`: for each `partnerProcesses`
  entry (NDT, heavy-lift, finish machining...) the same scorer ranks members for that step, and
  REED lists the partner's data assets the buyer may discover.

## Match lifecycle

```
PROPOSED --buyer shortlists--> SHORTLISTED --supplier accepts--> ACCEPTED
   ACCEPTED --buyer contracts over EDC for the supplier's ProcessCapability,
              REED verifies the agreement and checks the confidential figures--> CONFIRMED
                                                                           \--> REJECTED (claim not confirmed)
   SHORTLISTED --supplier declines--> DECLINED
   CONFIRMED --buyer / quality auditor records delivery feedback--> (track record)
```

Confirmation (`POST /reed/matches/{id}/confirm {agreementId}`):

1. the agreement id is validated and read **from the buyer's own connector**;
2. its asset must be the supplier's `ProcessCapability` and its parties the buyer's and the
   supplier's DIDs;
3. the confidential envelope, mass and tolerance are re-checked against the RFQ. If the
   confidential data does not back the public claim, the match is `REJECTED` with
   `CLAIM_NOT_CONFIRMED`, which lowers the supplier's track record.

Every step is an audit event (`MATCH`). Suppliers without a connector can be matched and
shortlisted but not confirmed - the UI says so ("invite it to onboard").

## The assistant (local LLM)

`services/reed-backend/.../assistant/`. The backend talks OpenAI-compatible HTTP to **LiteLLM**
(`deployment/litellm/config.yaml`), which routes the alias `reed-llm` to **Qwen3.8 on Ollama**
on the host and falls back to **vLLM** (`docker compose --profile vllm`, `nvidia/Qwen3.8-27B-NVFP4`).
Nothing leaves the deployment; no external AI service is used.

| Endpoint | What it does |
|---|---|
| `POST /reed/assistant/rfq-draft` | free text → structured RFQ via JSON-schema output; numbers (size, mass, tolerance, quantity, weeks) come from a deterministic parser, the model fills the semantics (sector, material, processes, certifications). Never posts on its own. |
| `POST /reed/assistant/explain/{rfqId}` | explains the scorer's ranking (buyer/operator only) |
| `POST /reed/assistant/chat` | tool-using chat: `list_open_rfqs`, `rank_suppliers`, `supplier_profile` |

Guardrails:

- **Scores only come from the scorer.** An explanation containing a decimal number that is not
  in the scorer's output is discarded and replaced by a template.
- **No personal data.** Before anything reaches the model, e-mail addresses, phone numbers and the
  caller's own name/username are replaced with `[person]` (`PersonalDataRedactor`); the same
  redaction applies to RFQ titles and descriptions before they are stored, because RFQs are
  visible to all members. Conversations are not stored; the audit records only the redaction count.
- **Visibility.** Tools run as the caller's organisation, injected server-side - the model cannot
  ask for another member's view.
- **Degradation.** If no model is reachable the endpoints answer from rules and say
  `source: "rules"`; the UI shows which one answered.

## Tests

- `MatchScorerTest` - rotation fit, self-declared certification, tie-breaking, contributions sum.
- `ScenarioFixtureTest` - every scenario's expected winner, runner-up, rejections and partners.
- `AssistantGuardrailsTest` - rule extraction, redaction (including what must *not* be redacted:
  part numbers, dates), number grounding.
- `run-matchmaking.sh` - the same scenarios over HTTP and EDC; `SCENARIO=R1` runs one.
- `services/reed-dashboard/e2e/reed.spec.ts` - the lifecycle in a real browser.

## Illustrative scenarios with a real company

K1 (cast swing-circle carrier) and K2 (welded boom) are placed at **Komatsu Mining Germany GmbH**
(Düsseldorf, a maker of large hydraulic mining shovels), at the user's request. They are invented
demo scenarios, not actual Komatsu purchases; the participant carries `"illustrative": true`, no
certifications, capabilities, VAT id or relations, and the dashboard labels it as illustrative.

## Adding a scenario

Add an entry to `deployment/scenarios/matchmaking.json` with `expectedTop` (and optionally
`expectedSecond`, `expectedRejections`, `expectedPartners`), run
`./gradlew :services:reed-backend:test`, and restart the backend (scenarios seed into an empty
database; `down -v` to reseed).
