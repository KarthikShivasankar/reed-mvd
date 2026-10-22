#!/usr/bin/env bash
#
# Seeds every participant's EDC connector from the REED backend (idempotent: what exists is updated).
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

send() { # send <METHOD> <connector> <path> <json> -> body + status line
  curl -sS -w '\n%{http_code}' -X "$1" "$(mgmt_url "$2")$3" -H "X-Api-Key: $(mgmt_key "$2")" \
       -H 'Content-Type: application/json' -d "$4"
}

post() { # post <connector> <path> <json>: create, or update what exists (409) so changed terms take effect
  local out code id
  id=$(jq -r '."@id"' <<<"$3")
  out=$(send POST "$1" "$2" "$3"); code=$(tail -n1 <<<"$out")
  if [[ $code == 409 ]]; then
    # policy definitions and CEL rules are updated by id, assets and contract definitions by body
    case $2 in */policydefinitions|*/celexpressions) out=$(send PUT "$1" "$2/$id" "$3") ;; *) out=$(send PUT "$1" "$2" "$3") ;; esac
    code=$(tail -n1 <<<"$out"); [[ $code == 2* ]] && code="$code (updated)"
  fi
  if [[ $code == 2* ]]; then printf '  %s %s\n' "$code" "$id"
  else echo "  HTTP $code on $2: $(sed '$d' <<<"$out")" >&2; return 1; fi
}

render() { curl -fsS "$REED_BACKEND/reed/edc/$1" -H "Authorization: Bearer $ADMIN"; }

for c in $(jq -r '.participants[] | select(.connector) | .connector.name' "$ROSTER"); do
  owner=$(bpn_of "$c")
  wait_for "connector $c" "$(mgmt_url "$c")/v4/assets/request" "X-Api-Key: $(mgmt_key "$c")"
  log "$c ($owner): CEL expressions"
  render celexpressions | jq -c '.[]' | while IFS= read -r item; do post "$c" /v5beta/celexpressions "$item"; done
  for kind in assets policydefinitions contractdefinitions; do
    log "$c ($owner): $kind"
    render "$kind?owner=$owner" | jq -c '.[]' | while IFS= read -r item; do post "$c" "/v4/$kind" "$item"; done
  done
done
log "seed complete - every connector offers its owner's REED assets (metadata only)"
