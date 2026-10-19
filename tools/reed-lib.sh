# Shared helpers for the REED shell scripts (sourced, not executed).
# Reads the roster and generated secrets; talks to Keycloak, the REED backend and
# connector Management APIs on localhost.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROSTER="$ROOT/deployment/roster.json"
# every https call trusts the REED local CA (deployment/tls, from the generator)
export CURL_CA_BUNDLE="$ROOT/deployment/tls/ca.crt"
set -a; # shellcheck disable=SC1091
source "$ROOT/deployment/.env"; set +a
REED_BACKEND="${REED_BACKEND:-https://localhost:8081}"
KEYCLOAK="${KEYCLOAK:-https://localhost:8180}"
DEMO_PASSWORD="$(jq -r .dataspace.demoPassword "$ROSTER")"
CTX='["https://w3id.org/edc/connector/management/v2"]'   # Management API v4 (CEL rules: v5beta)
QS='{"@context":["https://w3id.org/edc/connector/management/v2"],"@type":"QuerySpec","limit":500}'
PROTO="dataspace-protocol-http:2025-1"

log()  { printf '\n\033[1;34m[%s]\033[0m %s\n' "${LOG_TAG:-reed}" "$*"; }
pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAILED=1; }
FAILED=0

# connector <name> -> "prefix bpn"
prefix()   { jq -r --arg n "$1" '.participants[] | select(.connector.name==$n) | .connector.portPrefix' "$ROSTER"; }
bpn_of()   { jq -r --arg n "$1" '.participants[] | select(.connector.name==$n) | .bpn' "$ROSTER"; }
did_of()   { echo "did:web:$1-ih%3A7083:$1"; }   # each identity has its own IdentityHub
dsp_of()   { echo "https://$1:$(prefix "$1")194/protocol/2025-1"; }
mgmt_url() { echo "https://localhost:$(prefix "$1")193/management"; }
mgmt_key() { local v="MGMT_KEY_$(echo "$1" | tr 'a-z-' 'A-Z_')"; echo "${!v}"; }

# mgmt <connector> <METHOD> <path> [json]  -> body (curl -f: fails on HTTP errors)
mgmt() {
  local c=$1 m=$2 p=$3 d=${4:-}
  if [[ -n $d ]]; then
    curl -fsS -X "$m" "$(mgmt_url "$c")$p" -H "X-Api-Key: $(mgmt_key "$c")" -H 'Content-Type: application/json' -d "$d"
  else
    curl -fsS -X "$m" "$(mgmt_url "$c")$p" -H "X-Api-Key: $(mgmt_key "$c")"
  fi
}

# token <username> -> access token (password grant on the demo-only reed-cli client)
token() {
  curl -fsS "$KEYCLOAK/realms/reed/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=reed-cli -d "username=$1" -d "password=$DEMO_PASSWORD" | jq -r .access_token
}

# api <token> <METHOD> <path> [json] -> body; HTTP status via $(status) (survives $(...) subshells)
STATUS_FILE=$(mktemp); trap 'rm -f "$STATUS_FILE"' EXIT
api() {
  local t=$1 m=$2 p=$3 d=${4:-} out
  out=$(curl -sS -w '\n%{http_code}' -X "$m" "$REED_BACKEND$p" -H "Authorization: Bearer $t" \
          -H 'Content-Type: application/json' ${d:+-d "$d"})
  tail -n1 <<<"$out" >"$STATUS_FILE"; sed '$d' <<<"$out"
}
status() { cat "$STATUS_FILE"; }

wait_for() { # wait_for <description> <url> [header]
  log "waiting for $1"
  for _ in $(seq 1 90); do
    local code; code=$(curl -s -o /dev/null -w '%{http_code}' ${3:+-H "$3"} "$2" || true)
    [[ $code =~ ^[234] ]] && return 0
    sleep 2
  done
  echo "timed out waiting for $1 ($2)" >&2; return 1
}

# catalog <consumer> <provider> -> DCAT catalog JSON
catalog() {
  mgmt "$1" POST /v4/catalog/request '{"@context": '"$CTX"', "@type": "CatalogRequest",
    "counterPartyId": "'"$(did_of "$2")"'", "counterPartyAddress": "'"$(dsp_of "$2")"'", "protocol": "'$PROTO'"}'
}

datasets() { jq -c '[.dataset // [] | (if type=="array" then . else [.] end)[]]'; }

# negotiate <consumer> <provider> <assetId> <offer-json> -> final negotiation JSON
negotiate() {
  local c=$1 p=$2 a=$3 offer id neg st
  offer=$(jq -c --arg a "$a" --arg p "$(did_of "$p")" '. + {assigner: $p, target: $a}' <<<"$4")
  id=$(mgmt "$c" POST /v4/contractnegotiations '{"@context": '"$CTX"', "@type": "ContractRequest",
    "counterPartyAddress": "'"$(dsp_of "$p")"'", "protocol": "'$PROTO'", "policy": '"$offer"'}' | jq -r '."@id"')
  for _ in $(seq 1 45); do
    neg=$(mgmt "$c" GET "/v4/contractnegotiations/$id")
    st=$(jq -r .state <<<"$neg")
    [[ $st == FINALIZED || $st == TERMINATED ]] && break
    sleep 1
  done
  echo "$neg"
}

# pull <consumer> <provider> <agreementId> -> payload (HttpData-PULL transfer + EDR + data-plane GET)
# The transfer is started through the REED backend relay, which registers the transfer.process.started
# callback; the consumer connector then delivers the EDR to the backend (no EDR-cache polling).
pull() {
  local c=$1 p=$2 agr=$3 tp st edr admin
  admin=$(token reed-admin)
  tp=$(api "$admin" POST "/reed/connectors/$c/v4/transferprocesses" '{"@context": '"$CTX"', "@type": "TransferRequest",
    "counterPartyAddress": "'"$(dsp_of "$p")"'", "protocol": "'$PROTO'",
    "contractId": "'"$agr"'", "transferType": "HttpData-PULL"}' | jq -r '."@id"')
  for _ in $(seq 1 45); do
    st=$(mgmt "$c" GET "/v4/transferprocesses/$tp" | jq -r .state)
    [[ $st == STARTED || $st == TERMINATED ]] && break
    sleep 1
  done
  [[ $st == STARTED ]] || { echo "transfer $tp ended $st" >&2; return 1; }
  for _ in $(seq 1 20); do
    edr=$(api "$admin" GET "/reed/connectors/$c/edrs/$tp")
    [[ $(status) == 200 ]] && break
    sleep 1
  done
  curl -fsS "$(jq -r .endpoint <<<"$edr")" -H "Authorization: $(jq -r .authorization <<<"$edr")"
}
