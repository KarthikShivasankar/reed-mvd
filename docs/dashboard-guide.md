# Dashboard guide

The dashboard (http://127.0.0.1:8088) is where people from the member companies work. Every view
has a collapsible "What this view is for" explainer; this guide follows a full matchmaking case.

## Concepts in one table

| Concept | Meaning in REED |
|---|---|
| **Member** | a European company in the REED consortium, with a verified identity (DID + credentials) and usually an EDC connector |
| **RFQ** | a buyer's request for quotation for a part |
| **Capability claim** | what a supplier says it can make - public, used for ranking |
| **Verified certification** | issued as a credential by the REED issuer; only these pass hard requirements |
| **Asset** | a member's data (process capability, BOM, passport...): metadata discoverable, payload only after a contract |
| **Contract** | an EDC agreement between two connectors, granted only if the requester's credentials satisfy the provider's policy |
| **EDR** | the short-lived token that lets the contract holder pull the payload once |

## Walkthrough: R1, a rotor hub for an offshore wind farm

1. **Log in as `nordvind-buyer`** (password `reed-demo`). The badge top-right shows the
   organisation, role and verified certifications; *Waiting for you* lists open work.
2. **Overview → R1** opens the ranking. The RFQ needs sand casting and heat treatment, 4.2 × 4.0
   × 3.6 m, 38 t, DNV approval.
3. **Read the ranking.** Castellum (Bilbao) qualifies; its bar shows how each criterion
   contributed (hover a segment). Under *Filtered out*, Śląsk Odlewnia is the near miss: part
   too large, too heavy, and its DNV approval is only self-declared. Companies in other trades
   are folded away. *Partners for the other steps* recommends Rhein NDT for ultrasonic testing
   and Maasvlakte for heavy lift.
4. **Explain this ranking** asks the local model (Qwen3.8) for a plain-language explanation built
   only from the scorer's figures.
5. **Shortlist** Castellum. Log out (badge → Log out), **log in as `castellum-engineer`**,
   open **Opportunities**: Castellum sees its own score for R1 (never competitors') and accepts.
6. **Log back in as `nordvind-buyer`**, open R1, **Request capability via contract**. The
   diagram follows the real exchange: catalog request with credentials, contract agreed,
   transfer, EDR, payload pulled from Castellum's data plane. REED then checks the agreement on
   Nordvind's connector and compares the confidential figures with the RFQ: **Confirmed**.
7. **Contracts** shows the finalised negotiation and the transfer; **Audit** shows the RFQ,
   shortlist, acceptance, confirmation and assistant use.

## Other things to try

- **Data space → My data, my terms** (as `castellum-engineer`): the board shows, for each of your
  assets, which company finds it (◉) and which gets a contract (✓), with the reason per credential.
  Pick *Process Capability*, set the contract terms to `eu-member-states`: the column previews
  Nordvind (Norway - EEA, not EU) turning refused before anything is published. *Publish to my
  connector*, then log in as `nordvind-buyer` → *What I can get* → *Try anyway*: Castellum's connector
  refuses on `MembershipCredential.country`. Set it back to `oem-only` afterwards.
- **Data space → What I can get**: the credentials your connector presents and everything you may
  discover (nothing else is listed). *Get it* runs catalogue → contract → transfer → watermarked
  payload through the real connectors.
- **Data space → Cross-border stories**: the eight `run-interop.sh` stories; *Try it now* on the
  requests made by your company, *Apply these terms* on your own assets.
- **Factory → Line controls** (as `castellum-engineer` or `wisla-engineer`): *Inject spike* on a sensor -
  the tile turns *Alarm* within about a minute and an alert goes out on MQTT; *Maintain* clears it.

- **Marketplace → Post an RFQ**: describe a part in plain text and *Fill the form from this
  text* - the local model drafts it, personal details (names, e-mails, phones) are removed first.
- **Assistant**: "Why was Śląsk Odlewnia rejected for R1?", "Compare the suppliers for R9".
- **Members**: verified vs self-declared certifications (a `?` marks the latter), DIDs, which
  members run connectors.
- **Catalogue** as `reed-admin`: switch to another member's view to see bilateral assets appear
  and disappear with supply relations.
- **`vagant-buyer`**: a non-member sees an explanation and nothing else.

## Views and roles

| View | buyer | supplier-engineer | quality-auditor | admin |
|---|---|---|---|---|
| Overview, Marketplace, Assistant, Catalogue, EDC catalog, Audit, Members, Policies, Matrix | ✓ | ✓ | ✓ | ✓ |
| Data space (own terms: change with `data-steward`; others: look) | ✓ | ✓ | ✓ | look as any company |
| Factory (own line; controls + notes) | if the organisation runs a line | same | same | any line, read-only |
| Matches (full ranking of own RFQs) | ✓ | own row via link | own organisation | all |
| Opportunities | | ✓ | | ✓ |
| Contracts (own connector) | if the organisation runs one | same | same | all connectors |

## Command-line equivalents

```bash
./run-transfer.sh                 # the EDC exchange of step 6, plus two refusals
SCENARIO=R1 ./run-matchmaking.sh  # steps 2-6 over the APIs
./run-interop.sh                  # the Data space view's predictions vs every connector, and the stories
./run-factory.sh                  # Factory view incl. fault -> alarm -> maintenance
```
