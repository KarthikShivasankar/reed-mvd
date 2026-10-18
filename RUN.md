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

Writes the compose file, connector/identity configs, the Keycloak realm, the dashboard config,
EC P-256 keys under `deployment/vault/keys/` (gitignored) and **`deployment/.env`** with generated
secrets (Management API keys, IdentityHub super-user key, submodel master key, LiteLLM key -
gitignored, kept across runs). Re-run after every roster change; it is idempotent.

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

Startup order is encoded in `depends_on`: Vault → keys → Postgres → Keycloak and backend →
IdentityHub and Issuer Service → connectors → federated catalog.

| URL | |
|---|---|
| http://localhost:8088 | dashboard (log in as `nordvind-buyer` / `reed-demo`, see README) |
| http://localhost:8180 | Keycloak (admin console: `admin` / `admin`) |
| http://localhost:8081/reed/health | backend health |
| http://localhost:4000 | LiteLLM (key: `LITELLM_MASTER_KEY` in `deployment/.env`) |

## 4. Verify

```bash
./run-transfer.sh                         # EDC under DCP: 1 contract + pull, 2 refusals
./run-matchmaking.sh                      # 9 scenarios; SCENARIO=R1 for one
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
| connector / extension | rebuild the jar, `up --build -d <connectors>`, then `./seed-reed.sh` (stores are in memory) |
| roster or scenarios | `python3 tools/gen_topology.py`, then `down -v`, `up --build -d`, both seed scripts |
| LiteLLM routing | edit `deployment/litellm/config.yaml`, `docker compose ... restart litellm` |

## Troubleshooting

- **A connector restarted** → its assets, policies and CEL rules are gone (in-memory): `./seed-reed.sh`.
- **Vault restarted** → keys and credentials' secrets are gone (dev mode): `down -v` and start again.
- **`seed-identity.sh` waits forever** → `docker logs reed-issuerservice`; the backend must be
  healthy first (its migrations create the `vc_*` views the issuer reads).
- **Catalog request returns 401 / empty** → the requester lacks a credential; check
  `curl -H "x-api-key: $IH_SUPERUSER_KEY" localhost:7081/api/identity/v1alpha/participants/<name>/credentials`.
- **Negotiation `TERMINATED`** → read `errorDetail` (Contracts tab shows it): it names the
  constraint the requester's credentials did not satisfy.
- **Dashboard shows an old version** → it is served with `Cache-Control: no-cache`; a hard
  reload fixes browsers that cached it before that header existed.
- **Assistant says "rules"** → `docker logs reed-litellm`; check `curl localhost:11434/api/tags` on the host.
