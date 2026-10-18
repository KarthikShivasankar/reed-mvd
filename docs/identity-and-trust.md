# Identity and trust

REED separates **who an organisation is** (proved between connectors with verifiable
credentials) from **who a person is** (proved to the REED backend with a Keycloak login).

## Organisations: Decentralized Claims Protocol (DCP)

```
 Issuer Service  ── reads ──>  REED registry views (vc_membership, vc_certification, vc_supplier_relation)
   │ issues VCs (DCP)
   ▼
 IdentityHub  (one participant context per member: DID document, keys, credentials, STS)
   ▲  self-issued token + verifiable presentation
   │
 connector A  ──── DSP catalog / negotiation / transfer ────>  connector B
                                                               resolves A's did:web, verifies the
                                                               credentials (trusted issuer only),
                                                               evaluates its CEL policy rules
```

- **DIDs**: `did:web:identityhub%3A7083:<connector>` resolved at
  `http://identityhub:7083/<connector>/did.json`; the issuer is `did:web:issuerservice%3A10016:issuer`.
  The DID **is** the EDC participant id.
- **Credentials** (`VC1_0_JWT`, 30 days, revocable via a status list):

| Credential | Claims | Source |
|---|---|---|
| `MembershipCredential` | `bpn`, `role` (OEM / SUPPLIER / SERVICE), `membership=active`, organisation, country | `reed_participant` (consortium members only) |
| `CertificationCredential` | `certifications` e.g. `,DNV,ISO9001,PED,` | `reed_participant.attestations` |
| `SupplierRelationCredential` | `partners`, `projects` (BPNs) | `reed_supply_chain_relation` |

  The REED registry is the single source of truth; the Issuer Service reads it through
  read-only views (stock `database` attestations, `services/reed-backend/.../db/migration/V1__reed_schema.sql`).
- **Presentation**: all three credentials are configured as DEFAULT scopes, i.e. presented on
  every DSP request. Catalog requests carry no policy, so a credential that is only requested
  "when a policy needs it" would never reach the access policy that hides bilateral assets.
- **Policies**: left operands are bound to [CEL](https://cel.dev) rules over
  `ctx.agent.claims.vc`, registered on every connector by `seed-reed.sh`
  (`GET /reed/edc/celexpressions`):

| Left operand | Holds when |
|---|---|
| `MembershipCredential` | the requester holds a membership credential with `membership == rightOperand` |
| `MembershipCredential.role` | its `role == rightOperand` |
| `CertificationCredential.certification` | `certifications` contains the right operand |
| `SupplierRelationCredential.partner` | `partners` contains the right operand (a BPN) |
| `SupplierRelationCredential.project` | `projects` contains the right operand |

  Policy definitions are posted with the `https://w3id.org/edc/connector/management/v2` context
  and **no** `@vocab`, so these operands stay bare strings.

### How the REED policy layers map onto EDC

| Layer | EDC element | Example |
|---|---|---|
| Catalogue | contract definition's **access policy**, one per discoverability | consortium → `MembershipCredential eq active`; bilateral → `SupplierRelationCredential.partner eq <owner BPN>` |
| Contract | contract definition's **contract policy**, from the asset's template | `oem-only` → `MembershipCredential.role eq OEM` |
| Usage | `reed:odrl` asset property + REED audit | no redistribution, delete after pilot expiry, audit every pull |

`run-transfer.sh` proves all three: Nordvind (OEM) gets Castellum's process capability; Castellum
(SUPPLIER) is refused Wisła's (`Constraint 'MembershipCredential.role' EQ 'OEM'`); Hanse, with no
supply relation to Nordvind, does not even see Nordvind's bill of material.

### Seeding (`seed-identity.sh`)

1. issuer tenant; 2. three `database` attestation definitions; 3. three credential definitions;
4. for every member with a connector (and the operator running the federated catalog): a holder
in the Issuer Service and a participant context in the IdentityHub (DID document with
`CredentialService` and `ProtocolEndpoint`); 5. credential requests, waiting for `ISSUED`.
Every call is idempotent (409 = exists). The admin APIs are protected by the super-user key
generated into `deployment/.env` (`extensions/superuser-seed` creates that admin context, which
the non-OAuth IdentityHub/Issuer BOMs of 0.17.0 do not ship).

## People: Keycloak

- Realm `reed` (generated into `deployment/keycloak/reed-realm.json` from the roster).
- Roles: `buyer` (post RFQs, shortlist, confirm), `supplier-engineer` (answer matches),
  `quality-auditor` (audit, feedback), `admin` (operator).
- User attributes `bpn` and `participant` (connector name) are mapped into the access token,
  together with the audience `reed-backend`.
- Clients: `reed-dashboard` (public, authorization code + PKCE S256) and `reed-cli` (password
  grant, **demo scripts only**). Demo users are synthetic ("Demo User", `<company>-<role>`).

The backend is an OAuth2 resource server (`SecurityConfig`): keys are fetched in-cluster, the
issuer is checked against the browser-facing URL, the audience must be `reed-backend`.

### Rules enforced from the token, not from requests

- The organisation acting is the token's `bpn`; request parameters cannot change it.
- Cross-organisation views (another member's catalogue, every ranking, the whole audit trail) are
  for the operator only: `admin`, or a `quality-auditor` without an organisation.
- Only consortium members (`reed_participant.consortium`) may use matchmaking, the catalogue or
  the federated catalog.

## Connector Management APIs

Each connector's Management API requires its own key (`web.http.management.auth.type=tokenbased`,
key in Vault, value in `deployment/.env`). The dashboard reaches it only through
`/reed/connectors/{name}/**`, where the backend checks that the user belongs to the organisation
running `{name}` and adds the key server-side. EDR payload pulls go straight from the browser to
the provider's data plane - the short-lived EDR token is the authorisation.

## Submodel service keys

Provider data planes fetch payloads from `reed-backend /reed/submodels/{assetId}` with an
`X-Api-Key` derived per owner (`HMAC-SHA256(master key, owner BPN)`). A member can read its own
key from its own asset data addresses, but that key unlocks only its own payloads.
