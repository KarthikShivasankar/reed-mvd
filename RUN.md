# Running REED locally

This is the quick operational guide. For the architecture see `README.md` and
`docs/reed-data-model.md`.

## Prerequisites

- **Docker** 20.10+ with Compose v2
- `curl`, `jq`, `openssl`
- **JDK 17** *(only if you build the jars on the host — see Option B if you don't have it)*

## 0. One-time: generate the demo Vault keys

The P-256 PEMs are gitignored. Generate them once before the first run:

```bash
mkdir -p deployment/vault/keys
for p in reed-provider consumer-1; do
  openssl ecparam -name prime256v1 -genkey -noout -out deployment/vault/keys/$p-signing-key.pem
  openssl ec -in deployment/vault/keys/$p-signing-key.pem -pubout -out deployment/vault/keys/$p-verification-key.pem
done
```

## 1. Build the jars

Each Docker image copies a host-built jar, so the jars must exist before
`docker compose build`.

### Option A — you have JDK 17

```bash
./gradlew :launchers:connector:shadowJar :launchers:federated-catalog:shadowJar :services:reed-backend:bootJar
```

### Option B — Docker only (no host JDK 17)

Build the jars inside a JDK 17 container using the project's Gradle wrapper:

```bash
docker volume create reed-gradle-cache   # speeds up repeat builds
docker run --rm -v "$PWD":/src -v reed-gradle-cache:/root/.gradle -w /src \
  eclipse-temurin:17-jdk \
  ./gradlew --no-daemon --console=plain \
  :launchers:connector:shadowJar :launchers:federated-catalog:shadowJar :services:reed-backend:bootJar
```

Produces `connector.jar`, `federated-catalog.jar`, and `reed-backend.jar` under
each module's `build/libs/`.

## 2. Bring up the stack

Everything:

```bash
docker compose -f deployment/docker-compose.yml up --build -d
```

The `dashboard` service is a React + Vite SPA that builds in seconds. To run
just the **end-to-end data flow** (no UI), start the core services only:

```bash
docker compose -f deployment/docker-compose.yml up --build -d \
  vault init-vault postgres reed-backend reed-provider consumer-1 federated-catalog
```

Check health:

```bash
docker compose -f deployment/docker-compose.yml ps
```

`postgres`, `vault`, `reed-backend`, `reed-provider` should report `healthy`.

## 3. Seed the provider from REED

```bash
./seed-reed.sh
```

Renders the EDC assets/policies/contract-definitions from the REED
classification matrix and pushes them to `reed-provider` (idempotent; 409 = ok).

## 4. Run the end-to-end demo

```bash
./run-transfer.sh
```

Discovers the provider via the Federated Catalog, negotiates a contract for the
confidential `process-capability-001` asset, pulls the payload through the EDR
data plane, and prints the matching `PULL` audit event.

## Useful endpoints

```bash
# Classification matrix
curl -s http://localhost:8081/reed/classifications | jq

# Catalogue layer — discoverability per partner BPN
curl -s "http://localhost:8081/reed/catalogue?bpn=BPN-REED-SUP-0002" | jq   # supplier: consortium + bilateral
curl -s "http://localhost:8081/reed/catalogue?bpn=BPN-REED-SIM-0003" | jq   # sim svc: consortium + project
curl -s "http://localhost:8081/reed/catalogue?bpn=BPN-REED-OUT-9999" | jq   # outsider: consortium only

# Audit log
curl -s http://localhost:8081/reed/audit | jq

# Inspect the REED tables directly
docker exec mvd-postgres psql -U reed -d reed -c "\dt"
docker exec mvd-postgres psql -U reed -d reed -c "select * from reed_asset_classification;"

# Federated catalog (aggregated, metadata only)
curl -s -X POST http://localhost:39193/management/v3/catalogs/request \
  -H 'Content-Type: application/json' -d @deployment/requests/empty-query.json | jq

# REED Dashboard (React SPA — browser)
open http://localhost:8080
```

In the dashboard you can run the whole flow interactively from the **Negotiate**
tab (pick an asset → *negotiate & pull*). For a guided tour of every tab and a
manufacturing supply-chain walkthrough, see **`docs/dashboard-guide.md`**.

The dashboard reads its endpoints at runtime from `deployment/dashboard/config.json`
(bind-mounted to `/config.json`). To point it at different hosts/ports, edit that
file and hard-refresh the browser — no rebuild needed.

## Teardown

```bash
docker compose -f deployment/docker-compose.yml down -v
```

`-v` drops the Vault and Postgres volumes. Because the REED backend re-seeds its
tables on startup and `seed-reed.sh` re-seeds the connector, a fresh
`up` + `seed-reed.sh` restores everything.

## Troubleshooting

- **Provider crashes on first transfer with `JWSSigner cannot be generated`** —
  the Vault keys are missing/invalid. Redo step 0, then `down -v` and `up`.
- **`seed-reed.sh` gets connection refused** — the provider or backend isn't up
  yet; the script waits, but check `docker compose ps` and
  `docker logs mvd-reed-backend`.
- **Negotiation never reaches FINALIZED** — check `docker logs mvd-reed-provider`;
  ensure the contract policies are permissive `Set` policies (they must be under
  `iam-mock`; see `docs/reed-data-model.md`).
