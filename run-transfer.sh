#!/usr/bin/env bash
#
# End-to-end demo of the consumer-pull + EDR flow, modeled on the
# `transfer-04-consumer-pull-http` EDC sample.
#
#   1. consumer fetches the provider's catalog
#   2. consumer negotiates a contract based on the first offer
#   3. consumer starts a transfer with transferType=HttpData-PULL
#   4. consumer retrieves the EDR from its EDR cache
#   5. consumer uses the EDR's endpoint + authorization token to pull
#      the actual data through its data-plane public API
#
# Usage: ./run-transfer.sh
#
set -euo pipefail

CONSUMER_MGMT="${CONSUMER_MGMT:-http://localhost:29193/management}"
REED_BACKEND="${REED_BACKEND:-http://localhost:8081}"
REQUESTS_DIR="$(cd "$(dirname "$0")/deployment/requests" && pwd)"
# A confidential, bilateral REED asset (the ProcessCapability submodel).
ASSET_ID="${ASSET_ID:-process-capability-001}"
# Identity of the upstream EDC participant. Must match the catalog's
# ``participantId`` and the dataset's ``odrl:assigner`` - otherwise EDC will
# reject the negotiation with a policy validation error.
PROVIDER_ID="${PROVIDER_ID:-reed-provider}"
PROVIDER_DSP="${PROVIDER_DSP:-http://reed-provider:19194/protocol/2025-1}"

log() { printf '\n\033[1;32m[run]\033[0m %s\n' "$*"; }
jqget() { jq -r "$1"; }

# ---------- 1. Catalog ----------
log "fetching catalog from provider"
CATALOG=$(curl -fsS -X POST "${CONSUMER_MGMT}/v3/catalog/request" \
  -H 'Content-Type: application/json' \
  -d @"${REQUESTS_DIR}/fetch-catalog.json")
echo "$CATALOG" | jq '.'

# Pick the offer id for ``$ASSET_ID`` specifically. Falls back to the first
# dataset if no exact match (useful for debugging) but normally the filter
# should resolve.
OFFER_ID=$(echo "$CATALOG" | jq -r --arg aid "$ASSET_ID" '
  ((."dcat:dataset" // .datasets // .dataset // []) | (if type=="array" then . else [.] end)) as $ds
  | (($ds | map(select((.["@id"] // .id) == $aid)) | first)
     // ($ds | first))
  | (."odrl:hasPolicy" // .hasPolicy) as $p
  | (if ($p|type)=="array" then $p[0] else $p end)
  | (.["@id"] // .id)
')

if [[ -z "$OFFER_ID" || "$OFFER_ID" == "null" ]]; then
  echo "Could not extract offer id for asset ${ASSET_ID} from catalog - is the provider seeded?" >&2
  exit 1
fi
log "selected offer id: ${OFFER_ID}"

# ---------- 2. Contract negotiation ----------
log "negotiating contract"
NEG_PAYLOAD=$(cat <<JSON
{
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "ContractRequest",
  "counterPartyId": "${PROVIDER_ID}",
  "counterPartyAddress": "${PROVIDER_DSP}",
  "protocol": "dataspace-protocol-http:2025-1",
  "policy": {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@id": "${OFFER_ID}",
    "@type": "Offer",
    "assigner": "${PROVIDER_ID}",
    "target": "${ASSET_ID}",
    "permission": [],
    "prohibition": [],
    "obligation": []
  }
}
JSON
)
NEG_ID=$(curl -fsS -X POST "${CONSUMER_MGMT}/v3/contractnegotiations" \
  -H 'Content-Type: application/json' -d "$NEG_PAYLOAD" | jqget '.["@id"] // .id')
log "contract negotiation id: ${NEG_ID}"

log "waiting for negotiation to reach FINALIZED"
AGREEMENT_ID=""
for i in $(seq 1 60); do
  NEG=$(curl -fsS "${CONSUMER_MGMT}/v3/contractnegotiations/${NEG_ID}")
  STATE=$(echo "$NEG" | jqget '.state // ."edc:state"')
  AGREEMENT_ID=$(echo "$NEG" | jqget '.contractAgreementId // ."edc:contractAgreementId" // empty')
  if [[ "$STATE" == "FINALIZED" && -n "$AGREEMENT_ID" ]]; then
    break
  fi
  sleep 2
done
if [[ -z "$AGREEMENT_ID" ]]; then
  echo "Negotiation did not finalize in time" >&2
  exit 1
fi
log "contract agreement id: ${AGREEMENT_ID}"

# ---------- 3. Transfer (consumer PULL, EDR issued) ----------
log "starting transfer process (HttpData-PULL)"
TP_PAYLOAD=$(cat <<JSON
{
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "TransferRequest",
  "counterPartyId": "${PROVIDER_ID}",
  "counterPartyAddress": "${PROVIDER_DSP}",
  "protocol": "dataspace-protocol-http:2025-1",
  "contractId": "${AGREEMENT_ID}",
  "assetId": "${ASSET_ID}",
  "transferType": "HttpData-PULL"
}
JSON
)
TP_ID=$(curl -fsS -X POST "${CONSUMER_MGMT}/v3/transferprocesses" \
  -H 'Content-Type: application/json' -d "$TP_PAYLOAD" | jqget '.["@id"] // .id')
log "transfer process id: ${TP_ID}"

log "waiting for transfer process to reach STARTED"
for i in $(seq 1 60); do
  STATE=$(curl -fsS "${CONSUMER_MGMT}/v3/transferprocesses/${TP_ID}" | jqget '.state // ."edc:state"')
  if [[ "$STATE" == "STARTED" ]]; then
    break
  fi
  sleep 2
done

# ---------- 4. Fetch EDR from the consumer's EDR cache ----------
log "fetching EDR data address from EDR cache"
EDR=""
for i in $(seq 1 30); do
  EDR=$(curl -fsS "${CONSUMER_MGMT}/v3/edrs/${TP_ID}/dataaddress" || true)
  if [[ -n "$EDR" && "$EDR" != "null" ]]; then
    break
  fi
  sleep 2
done
echo "$EDR" | jq '.'

ENDPOINT=$(echo "$EDR" | jqget '.endpoint // ."edc:endpoint"')
AUTH=$(echo "$EDR" | jqget '.authorization // ."edc:authorization"')
if [[ -z "$ENDPOINT" || -z "$AUTH" ]]; then
  echo "EDR missing endpoint or authorization - transfer may not have started" >&2
  exit 1
fi

# ---------- 5. Pull the data through the consumer's data plane ----------
log "pulling data via EDR: ${ENDPOINT}"
# Use ``-i`` so a non-2xx response prints the status line and entity body
# (which our http-pull-proxy uses to surface upstream failures, e.g.
# ``proxy error: <java exception>``).
curl -i -sS "${ENDPOINT}" -H "Authorization: ${AUTH}"

# ---------- 6. Show the REED audit trail ----------
# The confidential payload only became reachable after the contract finalized;
# the submodel service recorded a PULL event when the data plane fetched it.
log "REED audit trail for ${ASSET_ID} (most recent PULL events)"
curl -fsS "${REED_BACKEND}/reed/audit" \
  | jq --arg aid "$ASSET_ID" '[.[] | select(.assetId == $aid and .eventType == "PULL")] | .[0:3]'

log "demo complete"
