#!/usr/bin/env bash
#
# Restart resilience: stops and starts the whole stack WITHOUT dropping volumes, then checks that
# nothing has to be re-seeded - Vault secrets and DIDs, issued credentials, connector assets,
# policies and CEL rules, earlier contract agreements, Keycloak users and the REED registry.
#
# Usage: ./run-persistence.sh     (stack up and seeded; takes a few minutes)
set -euo pipefail
LOG_TAG=persist
source "$(dirname "$0")/tools/reed-lib.sh"
COMPOSE="docker compose -f $ROOT/deployment/docker-compose.yml"

snapshot() {
  echo "assets=$(mgmt castellum POST /v4/assets/request "$QS" | jq length)"
  echo "agreements=$(mgmt nordvind POST /v4/contractagreements/request "$QS" | jq length)"
  echo "cel=$(mgmt wisla POST /v5beta/celexpressions/request "$QS" | jq length)"
  # credentials still ISSUED (state 500) in every member's IdentityHub - not merely stored
  local issued=0 n px key
  while read -r n px; do
    key="IH_KEY_$(echo "$n" | tr 'a-z-' 'A-Z_')"
    issued=$((issued + $(curl -fsS -H "x-api-key: ${!key}" "https://localhost:${px}081/api/identity/v1alpha/participants/$n/credentials" \
      | jq '[.[] | select(.state == 500)] | length')))
  done < <(jq -r '.participants[] | select((.consortium // true) and (.connector or .identity))
                  | "\(.connector.name // .identity) \(.connector.portPrefix // "39")"' "$ROSTER")
  echo "issued-credentials=$issued"
  echo "rfqs=$(api "$(token reed-admin)" GET /reed/rfqs | jq length)"
}

log "before restart"
BEFORE=$(snapshot); echo "$BEFORE"
AGR=$(mgmt nordvind POST /v4/contractagreements/request "$QS" | jq -r '.[0]["@id"] // empty')

log "stopping and starting the whole stack (volumes kept)"
$COMPOSE down
$COMPOSE up -d
wait_for "REED backend" "$REED_BACKEND/reed/health"
for c in $(jq -r '.participants[] | select(.connector) | .connector.name' "$ROSTER"); do
  wait_for "connector $c" "$(mgmt_url "$c")/v4/assets/request" "X-Api-Key: $(mgmt_key "$c")"
done

log "after restart (no seeding)"
AFTER=$(snapshot); echo "$AFTER"
[[ "$BEFORE" == "$AFTER" ]] && pass "assets, agreements, CEL rules, credentials and RFQs all survived" \
  || fail "state changed across the restart"
if [[ -n $AGR ]]; then
  mgmt nordvind GET "/v4/contractagreements/$AGR" >/dev/null && pass "earlier agreement $AGR still readable" \
    || fail "agreement $AGR lost"
fi

log "a fresh exchange works straight away"
"$ROOT/run-transfer.sh" > /tmp/reed-persist-transfer.$$ 2>&1 && pass "run-transfer.sh passes after the restart" \
  || { fail "run-transfer.sh failed after the restart"; grep -E "FAIL" /tmp/reed-persist-transfer.$$ || true; }
rm -f /tmp/reed-persist-transfer.$$
log "done"
exit $FAILED
