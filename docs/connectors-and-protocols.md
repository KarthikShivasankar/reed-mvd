# Connectors, communication and protocols

Every container in the REED stack, its ports, and who talks to whom. Generated from
`deployment/roster.json` by `tools/gen_topology.py`.

## Containers

| Container | Host ports | Role |
|---|---|---|
| `reed-dashboard` | 8088 | React SPA (nginx). Talks to Keycloak, the REED backend and providers' public data planes. |
| `reed-keycloak` | 8180 | OIDC login for people; realm `reed` |
| `reed-backend` | 8081 | REED registry, matchmaking, assistant, relay to Management APIs, usage decisions, EDC callbacks (Postgres) |
| `reed-<name>-data` (7×) | - | each company's data service: its confidential payloads, released under licence |
| `reed-litellm` | 4000 | OpenAI-compatible gateway → Ollama `qwen3.8` on the host, or `reed-vllm` |
| `reed-vllm` | 8000 | *(profile `vllm`)* Qwen3.8 NVFP4 on the GPU |
| `reed-<name>-ih` (7×) | `<p>081` | one IdentityHub per company and for the operator: DID, keys, verifiable credentials, STS |
| `reed-issuerservice` | 10013, 10015 | REED credential issuer; attestations read from the REED registry |
| `reed-nordvind`, `reed-hanse`, `reed-castellum`, `reed-wisla`, `reed-maasvlakte`, `reed-rhein-ndt` | `<p>193`, `<p>291` | one EDC connector per member (control + data plane) |
| `reed-federated-catalog` | 39193 | crawls every member's catalog with the operator's credentials |
| `reed-vault` + `reed-vault-init` | 8200 | Vault with file storage; `vault-init` initialises/unseals it and provisions one folder, policy and token per identity, then exits (exit 0 = success) |
| `reed-postgres` | 5432 | databases `reed`, `keycloak`, `issuer`, `ih_<name>` per IdentityHub, `edc_<name>` per connector |

## Port convention

Each connector has a two-digit prefix `<p>`: **19** nordvind, **29** castellum, **41** hanse,
**42** wisla, **43** maasvlakte, **44** rhein-ndt, **45** komatsu, **39** federated catalog. Its IdentityHub's admin
API is published on `<p>081`. Every published port is bound to `127.0.0.1`.

| Port | Path | Context | Called by | Exposed on host |
|---|---|---|---|---|
| `<p>191` | `/api` | default, health | internal | no |
| `<p>192` | `/control` | data-plane signaling | its own control plane | no |
| `<p>193` | `/management` | Management API, **key-protected** | REED backend relay, seed/run scripts | yes |
| `<p>194` | `/protocol/2025-1` | DSP | other connectors, federated catalog | no |
| `<p>195` | `/version` | version | tooling | no |
| `<p>291` | `/public` | public data plane (`http-pull-proxy`) | the consumer, with an EDR token | yes |

## Who talks to whom

| From | To | Endpoint | Protocol | Purpose |
|---|---|---|---|---|
| browser | keycloak | `:8180/realms/reed` | OIDC + PKCE | log in |
| browser | reed-backend | `:8081/reed/*` | REST + bearer token | everything except payload pulls |
| reed-backend | user's own connector | `<p>193/management` | Management API + key | catalog, negotiation, transfer, EDR (relay) |
| reed-backend | keycloak | `keycloak:8080/.../certs` | JWKS | verify tokens |
| reed-backend | litellm | `litellm:4000/v1` | OpenAI API | assistant |
| connector | connector | `<p>194/protocol/2025-1` | DSP + verifiable presentation | catalog, negotiation, transfer |
| connector | its own `<name>-ih` | `7084/api/sts`, `7082/api/credentials` | DCP | self-issued token, present credentials |
| connector | counterparty's `<name>-ih` | `7083/<name>/did.json` | did:web | resolve the counterparty |
| connector | issuerservice | `9999/statuslist` | HTTP | credential revocation status |
| `<name>-ih` | issuerservice | `10012/api/issuance`, `9999/statuslist` | DCP | credential requests, revocation status |
| issuerservice | postgres `reed` | `vc_*` views | JDBC | attestations |
| federated-catalog | all connectors | `<p>194` | DSP | crawl every 15 s |
| browser | provider | `<p>291/public` | HTTP + EDR JWT | pull the confidential payload |
| provider data plane | its own `<name>-data` | `:8090/submodels/<asset>` | HTTP + data key + consumer DID | fetch the payload it streams back |
| `<name>-data` | reed-backend | `:8080/reed/usage/decide` | HTTP + data key | usage decision (agreement, expiry), audited |
| consumer connector | reed-backend | `:8080/reed/edc-callbacks/<name>` | HTTP + callback key | deliver the EDR (transfer.process.started) |
| every EDC runtime | vault | `vault:8200` `secret/<name>/` | Vault HTTP + own token | keys and secrets, confined to its own folder |

## The URL rule

Anything resolved **container to container** uses Docker service names (`castellum:29194`, DIDs
on `castellum-ih:7083`, `reed-backend:8080`). Anything the **browser or host scripts** call uses
`localhost` (dashboard config, `edc.dataplane.api.public.baseurl`, Keycloak hostname). Most
connectivity bugs are a URL on the wrong side of that line.

## Protocols

- **DSP** (Dataspace Protocol 2025-1) - asynchronous JSON-LD between connectors.
- **DCP** (Decentralized Claims Protocol) - every DSP request carries a token from the
  requester's IdentityHub STS; the provider fetches a verifiable presentation of the requester's
  credentials, checks the issuer is trusted, then evaluates its policies.
- **Management API** - REST (v4; EDR cache v3, CEL v5beta) to drive your own connector; never exposed to browsers.
- **EDR** - short-lived ES256 JWT minted by the provider data plane after a contract, valid for
  pulls of that one asset.
- **OIDC** - human login; tokens carry roles and the organisation.
