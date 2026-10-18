#!/usr/bin/env bash
#
# Seeds every participant's EDC connector from the REED backend (idempotent; 409 = exists).
#
# REED is the source of truth: for each owner the backend renders assets, credential-constrained
# policy definitions (access policy per discoverability + contract policy per template), contract
# definitions, and the CEL expressions that bind the policy left operands to verifiable
# credentials. Only metadata is published; confidential payloads stay in the submodel service
# until a contract is agreed.
#
# Usage: ./seed-reed.sh     (after ./seed-identity.sh)
set -euo pipefail
LOG_TAG=seed
source "$(dirname "$0")/tools/reed-lib.sh"

wait_for "REED backend" "$REED_BACKEND/reed/health"
wait_for "Keycloak" "$KEYCLOAK/realms/reed/.well-known/openid-configuration"
ADMIN=$(token reed-admin)

post() { # post <connector> <path> <json>
  local out code
  out=$(curl -sS -w '\n%{http_code}' -X POST "$(mgmt_url "$1")$2" -H "X-Api-Key: $(mgmt_key "$1")" \
          -H 'Content-Type: application/json' -d "$3")
  code=$(tail -n1 <<<"$out")
  if [[ $code == 2* ]]; then printf '  %s %s\n' "$code" "$(jq -r '."@id" // .id // ""' <<<"$(sed '$d' <<<"$out")")"
  elif [[ $code == 409 ]]; then echo "  409 (exists)"
  else echo "  HTTP $code on $2: $(sed '$d' <<<"$out")" >&2; return 1; fi
}

render() { curl -fsS "$REED_BACKEND/reed/edc/$1" -H "Authorization: Bearer $ADMIN"; }

for c in $(jq -r '.participants[] | select(.connector) | .connector.name' "$ROSTER"); do
  owner=$(bpn_of "$c")
  wait_for "connector $c" "$(mgmt_url "$c")/v3/assets/request" "X-Api-Key: $(mgmt_key "$c")"
  log "$c ($owner): CEL expressions"
  render celexpressions | jq -c '.[]' | while IFS= read -r item; do post "$c" /v5beta/celexpressions "$item"; done
  for kind in assets policydefinitions contractdefinitions; do
    log "$c ($owner): $kind"
    render "$kind?owner=$owner" | jq -c '.[]' | while IFS= read -r item; do post "$c" "/v3/$kind" "$item"; done
  done
done
log "seed complete - every connector offers its owner's REED assets (metadata only)"
