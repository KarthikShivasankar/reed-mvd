# Running REED locally

Operational guide. Architecture: `README.md`, `docs/`.

## Prerequisites

- Docker with Compose v2, `curl`, `jq`, `openssl`, Python 3
- JDK 17 on the host, **or** build inside Docker (Option B)
- For the assistant: Ollama with `ollama pull qwen3.8` (listening on `0.0.0.0:11434` so containers
  reach it via `host.docker.internal`), or an NVIDIA GPU for the vLLM profile. Without either, the
  assistant answers from rules.

## 1. Generate the topology

```bash
python3 tools/gen_topology.py
```

Writes the compose file, connector/IdentityHub/issuer configs, the Vault init script, the
Postgres init script, the Keycloak realm, the dashboard config, EC P-256 keys under
`deployment/vault/keys/` (gitignored) and **`deployment/.env`** (mode 600, gitignored, kept across
runs) with generated secrets: Management API keys, per-identity IdentityHub admin keys and Vault
tokens, the issuer key, the Postgres and Keycloak admin passwords, per-company data and callback keys and
the LiteLLM key. Re-run after every roster change; it is idempotent.

## 2. Build the jars

Option A - JDK 17 on the host:

```bash
./gradlew :launchers:connector:shadowJar :launchers:federated-catalog:shadowJar \
          :launchers:identity-hub:shadowJar :launchers:issuerservice:shadowJar \
          :services:reed-backend:bootJar
```

Option B - Docker only:

```bash
docker run --rm -v "$PWD":/src -v reed-gradle-cache:/root/.gradle -w /src eclipse-temurin:17-jdk \
  ./gradlew --no-daemon :launchers:connector:shadowJar :launchers:federated-catalog:shadowJar \
  :launchers:identity-hub:shadowJar :launchers:issuerservice:shadowJar :services:reed-backend:bootJar
```

(Option B leaves root-owned `build/` directories; `sudo chown -R $USER .` before building on the
host again.)

## 3. Start and seed

```bash
docker compose -f deployment/docker-compose.yml up --build -d     # add --profile vllm for the GPU backend
./seed-identity.sh      # issuer, DIDs, credentials (all must reach ISSUED)
./seed-reed.sh          # per-owner assets, policies, contract definitions, CEL rules
```

Startup order is encoded in `depends_on`: Vault → `vault-init` (initialise once, unseal, one
folder/policy/token per identity, load keys) → Postgres → Keycloak → backend → Issuer Service →
one IdentityHub per identity → connectors → federated catalog. Seeding is needed **once**:
everything persists across `down`/`up`.

| URL | |
|---|---|
| http://127.0.0.1:8088 | dashboard - the browser's only origin: Keycloak, backend and data planes are proxied behind it (log in as `nordvind-buyer` / `reed-demo`, see README) |
| http://127.0.0.1:8088/admin | Keycloak admin console ( `admin` / `KEYCLOAK_ADMIN_PASSWORD` in `deployment/.env`) |
| http://localhost:8081/reed/health | backend health |
| http://localhost:4000 | LiteLLM (key: `LITELLM_MASTER_KEY` in `deployment/.env`) |

## 4. Verify

```bash
./run-transfer.sh                         # EDC under DCP: 1 contract + pull, 2 refusals
./run-matchmaking.sh                      # 11 scenarios; SCENARIO=R1 for one
./run-persistence.sh                      # down + up (volumes kept), then checks nothing was lost
./gradlew :services:reed-backend:test     # scorer, fixtures, assistant guardrails
cd services/reed-dashboard && npx playwright test   # UI end to end (npx playwright install chromium once)
```

Each prints `PASS`/`FAIL` lines and exits non-zero on failure. `run-matchmaking.sh` creates new
RFQs each run, so it can be repeated.

## Rebuilding one part

| Changed | Command |
|---|---|
| backend code | `./gradlew :services:reed-backend:bootJar && docker compose -f deployment/docker-compose.yml up --build -d reed-backend` |
| dashboard | `docker compose -f deployment/docker-compose.yml up --build -d dashboard` |
| connector / extension | rebuild the jar, `up --build -d <connectors>` (stores persist; no seeding) |
| roster or scenarios | `python3 tools/gen_topology.py`, then `down -v`, `up --build -d`, both seed scripts |
| LiteLLM routing | edit `deployment/litellm/config.yaml`, `docker compose ... restart litellm` |

## Troubleshooting

- **Vault sealed** after its container was restarted on its own → `docker compose -f deployment/docker-compose.yml up -d vault-init` unseals it.
- **`seed-identity.sh` waits forever** → `docker logs reed-issuerservice`; the backend must be
  healthy first (its migrations create the `vc_*` views the issuer reads).
- **Credentials not ISSUED** (e.g. an IdentityHub started while the issuer was down: EDC moves them
  to ERROR) → re-run `./seed-identity.sh`; it re-requests every credential that is not ISSUED.
- **Catalog request returns 401 / empty** → the requester lacks a credential; check
  `curl -H "x-api-key: $IH_KEY_<NAME>" localhost:<prefix>081/api/identity/v1alpha/participants/<name>/credentials`.
- **Negotiation `TERMINATED`** → read `errorDetail` (Contracts tab shows it): it names the
  constraint the requester's credentials did not satisfy.
- **Dashboard shows an old version** → it is served with `Cache-Control: no-cache`; a hard
  reload fixes browsers that cached it before that header existed.
- **Assistant says "rules"** → `docker logs reed-litellm`; check `curl localhost:11434/api/tags`
  on the host. With `--profile vllm` up, LiteLLM fails over to vLLM automatically.
- **Changed demo users in the roster** → Keycloak imports the realm only into an empty database:
  `down -v` and start again.
