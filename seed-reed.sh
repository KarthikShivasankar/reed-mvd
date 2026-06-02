#!/usr/bin/env bash
#
# Seeds the reed-provider connector from the REED backend.
#
# REED is the source of truth: the backend renders the EDC assets, policy
# definitions and contract definitions from its classification matrix + policy
# templates, and this script pushes them into the connector's Management API.
# Only metadata is published; the confidential payloads stay in the submodel
# service until a contract is accepted.
#
# Usage: ./seed-reed.sh
#
set -euo pipefail

PROVIDER_MGMT="${PROVIDER_MGMT:-http://localhost:19193/management}"
REED_BACKEND="${REED_BACKEND:-http://localhost:8081}"

log() { printf '\n\033[1;34m[seed]\033[0m %s\n' "$*"; }

log "waiting for REED backend at ${REED_BACKEND}"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${REED_BACKEND}/reed/classifications" 2>/dev/null || echo 000)
  [[ "$code" == "200" ]] && break
  sleep 2
done

log "waiting for reed-provider management API at ${PROVIDER_MGMT}"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
           "${PROVIDER_MGMT}/v3/assets/request" \
           -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo 000)
  # any 2xx/4xx response means the server is listening
  if [[ "$code" =~ ^[24] ]]; then
    break
  fi
  sleep 2
done

# idempotent POST: 409 means "already exists", treat as success
post() {
  local url=$1 payload=$2
  local code
  code=$(curl -sS -o /tmp/seed-out.$$ -w '%{http_code}' -X POST "$url" \
           -H 'Content-Type: application/json' -d "$payload")
  if [[ "$code" == 2* ]]; then
    jq -c '{"@id": (.["@id"] // .id)}' < /tmp/seed-out.$$ 2>/dev/null || cat /tmp/seed-out.$$
  elif [[ "$code" == "409" ]]; then
    echo "(already exists - skipping)"
  else
    echo "HTTP $code:"; cat /tmp/seed-out.$$; echo; return 1
  fi
  rm -f /tmp/seed-out.$$
}

# Pull each rendered EDC collection from the backend and POST every element.
seed_kind() {
  local kind=$1 mgmt_path=$2
  log "seeding ${kind} (rendered from REED tables)"
  local items
  items=$(curl -fsS "${REED_BACKEND}/reed/edc/${kind}")
  echo "$items" | jq -c '.[]' | while IFS= read -r item; do
    post "${PROVIDER_MGMT}/v3/${mgmt_path}" "$item"
  done
}

seed_kind assets             assets
seed_kind policydefinitions  policydefinitions
seed_kind contractdefinitions contractdefinitions

log "seed complete - reed-provider now offers the 8 REED asset classes (metadata only)"
