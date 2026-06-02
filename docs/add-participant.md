# Adding a New Participant to the Dataspace

This guide walks through every step required to add a new connector participant
(provider or consumer) to the REED dataspace. Use `reed-provider` as a
concrete reference — substitute your own participant name and port range
throughout.

> A REED **provider** also needs data to offer. The `reed-provider` is backed by
> the `reed-backend` service, which renders its EDC assets/policies from the
> REED classification matrix (see `docs/reed-data-model.md`). A new provider
> either points at the same `reed-backend` or brings its own HttpData backend.

---

## 1. Choose a name and port range

Pick a participant ID that is unique within the dataspace and a port block that
does not clash with existing services.

| Participant      | Default API | Control | Management | Protocol (DSP) | Version | Public (data-plane) |
|------------------|-------------|---------|------------|----------------|---------|---------------------|
| reed-provider    | 19191       | 19192   | 19193      | 19194          | 19195   | 19291               |
| consumer-1       | 29191       | 29192   | 29193      | 29194          | 29195   | 29291               |
| _your-connector_ | **?9191**   | **?9192** | **?9193** | **?9194**    | **?9195** | **?9291**         |

A simple convention: assign a unique tens digit (`1x`, `2x`, `3x`, `4x`, …) to
each participant and use the same suffix pattern (`x191`–`x195`, `x291`).

---

## 2. Generate P-256 signing keys

Each connector needs its own key pair for signing and verifying EDR JWTs.

```bash
openssl ecparam -name prime256v1 -genkey -noout \
  -out deployment/vault/keys/<name>-signing-key.pem

openssl ec -in deployment/vault/keys/<name>-signing-key.pem \
  -pubout -out deployment/vault/keys/<name>-verification-key.pem
```

Replace `<name>` with your participant ID (e.g. `reed-provider`).

---

## 3. Create the connector config directory and `config.properties`

```bash
mkdir -p deployment/<name>
```

Create `deployment/<name>/config.properties` using the template below,
substituting `<name>`, `<mgmt-port>`, `<dsp-port>`, `<default-port>`,
`<control-port>`, `<version-port>`, and `<public-port>`:

```properties
# --- <name> connector configuration ---
edc.participant.id=<name>
edc.runtime.id=<name>

# API endpoints (container-internal ports)
web.http.port=<default-port>
web.http.path=/api
web.http.management.port=<mgmt-port>
web.http.management.path=/management
web.http.control.port=<control-port>
web.http.control.path=/control
web.http.protocol.port=<dsp-port>
web.http.protocol.path=/protocol
web.http.version.port=<version-port>
web.http.version.path=/version

# DSP callback address (Docker service name – resolved connector-to-connector)
edc.dsp.callback.address=http://<name>:<dsp-port>/protocol

# Data-plane public API (use localhost – accessed by browser / external client)
edc.dataplane.api.public.baseurl=http://localhost:<public-port>/public/
web.http.public.port=<public-port>
web.http.public.path=/public

# Vault key aliases
edc.transfer.proxy.token.signer.privatekey.alias=<name>-signing-key
edc.transfer.proxy.token.verifier.publickey.alias=<name>-verification-key

# HashiCorp Vault
edc.vault.hashicorp.url=http://vault:8200
edc.vault.hashicorp.token=root
edc.vault.hashicorp.health.check.enabled=false

# CORS – required for the browser-based Data Dashboard
edc.web.rest.cors.enabled=true
edc.web.rest.cors.origins=*
edc.web.rest.cors.headers=origin, content-type, accept, authorization, x-api-key
edc.web.rest.cors.methods=GET, POST, DELETE, PUT, OPTIONS
```

> **URL rule of thumb**
>
> | Property | Resolved by | Must use |
> |---|---|---|
> | `edc.dsp.callback.address` | Other connectors inside Docker | Docker service name |
> | `edc.dataplane.api.public.baseurl` | Browser / external script | `localhost` |

---

## 4. Seed the new keys into Vault (`docker-compose.yml`)

Open `deployment/docker-compose.yml` and add two lines to the `init-vault`
`command` block:

```yaml
vault kv put secret/<name>-signing-key      content=@/keys/<name>-signing-key.pem
vault kv put secret/<name>-verification-key content=@/keys/<name>-verification-key.pem
```

---

## 5. Add the service to `docker-compose.yml`

Add a new service block. Copy the pattern from `reed-provider`:

```yaml
  # ---------- <Name> ----------
  <name>:
    build:
      context: ../launchers/connector
      dockerfile: Dockerfile
    container_name: mvd-<name>
    depends_on:
      init-vault:
        condition: service_completed_successfully
      reed-backend:
        condition: service_started       # omit if the connector is consumer-only
    volumes:
      - ./<name>/config.properties:/app/config/config.properties:ro
    ports:
      - "<default-port>:<default-port>"
      - "<control-port>:<control-port>"
      - "<mgmt-port>:<mgmt-port>"
      - "<dsp-port>:<dsp-port>"
      - "<version-port>:<version-port>"
      - "<public-port>:<public-port>"
```

Also add `<name>` to the `depends_on` of both `federated-catalog` and
`dashboard`:

```yaml
  federated-catalog:
    depends_on:
      <name>:
        condition: service_started
      ...

  dashboard:
    depends_on:
      - <name>
      ...
```

---

## 6. Register in the Federated Catalog (`participants.json`)

Open `deployment/federated-catalog/participants.json` and append an entry:

```json
{
  "name": "<name>",
  "id": "<name>",
  "url": "http://<name>:<dsp-port>/protocol/2025-1",
  "supportedProtocols": ["dataspace-protocol-http:2025-1"]
}
```

The FC crawler picks this up automatically on its next cycle (every 15 s by
default). No restart is needed if the FC is already running; if it is not
started yet, it will crawl on first boot.

---

## 7. Add to the Data Dashboard (`edc-connector-config.json`)

Open `deployment/dashboard/edc-connector-config.json` and append:

```json
{
  "connectorName": "<name>",
  "managementUrl": "http://localhost:<mgmt-port>/management",
  "defaultUrl": "http://localhost:<default-port>/api",
  "protocolUrl": "http://<name>:<dsp-port>/protocol/2025-1",
  "federatedCatalogEnabled": false,
  "federatedCatalogUrl": "",
  "did": "<name>"
}
```

> `managementUrl` and `defaultUrl` use `localhost` because they are called
> directly from the browser. `protocolUrl` uses the Docker service name because
> it is sent as `counterPartyAddress` to the consumer connector (server-side).
>
> `did` is used as the `counterPartyId` in catalog requests. Set it to the
> participant ID so the dropdown selection works correctly.

The dashboard config is volume-mounted, so a browser hard-refresh
(`Cmd+Shift+R`) is enough — no container restart required.

---

## 8. Create a seed script (providers only)

If the new participant is a **provider**, create a seed script so you can
register assets, policies, and contract definitions:

```bash
cp seed-reed.sh seed-<name>.sh
chmod +x seed-<name>.sh
```

Then edit `seed-<name>.sh` and change the default `PROVIDER_MGMT` URL (and, if
the provider uses its own data backend, `REED_BACKEND`):

```bash
PROVIDER_MGMT="${PROVIDER_MGMT:-http://localhost:<mgmt-port>/management}"
```

---

## 9. Apply the changes

Since Vault keys and the `init-vault` command changed, the Vault volume must be
re-created. Bring the whole stack down with `-v` (removes volumes) then restart:

```bash
docker compose -f deployment/docker-compose.yml down -v
docker compose -f deployment/docker-compose.yml up --build -d
```

Then seed any provider connectors:

```bash
./seed-reed.sh
./seed-<name>.sh      # if the new participant is a provider
```

---

## Checklist

- `deployment/vault/keys/<name>-signing-key.pem` — generated
- `deployment/vault/keys/<name>-verification-key.pem` — generated
- `deployment/<name>/config.properties` — created
- `deployment/docker-compose.yml` — `init-vault` command updated, new service added, `federated-catalog` and `dashboard` depends_on updated
- `deployment/federated-catalog/participants.json` — entry added
- `deployment/dashboard/edc-connector-config.json` — entry added
- `seed-<name>.sh` — created and made executable (providers only)
- Stack restarted with `down -v` + `up --build`
- Provider seeded with `./seed-<name>.sh` (providers only)
