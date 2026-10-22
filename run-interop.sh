#!/usr/bin/env bash
#
# Interoperability between every REED company, checked against the real connectors (DCP + CEL):
#
#   1. catalogue   every connector asks every other connector for its catalogue; what it sees must be
#                  exactly what REED's policy evaluator predicts from its verifiable credentials
#   2. contracts   for every company pair and every distinct contract policy it can see, one negotiation:
#                  FINALIZED or TERMINATED exactly as predicted
#   3. scenarios   cross-border stories (deployment/scenarios/interop.json): the owner sets an asset's terms
#                  through REED (published to its own connector), companies ask, outcomes and refusal reasons
#                  must match the story and REED's preview; payloads are pulled where the story says so.
#                  Every changed term is restored afterwards.
#
# Usage: ./run-interop.sh            (after ./seed-identity.sh and ./seed-reed.sh). Exit code 0 = all PASS.
#        SCENARIO=X2 ./run-interop.sh   one scenario only (skips 1 and 2)
set -euo pipefail
LOG_TAG=interop
source "$(dirname "$0")/tools/reed-lib.sh"

ADMIN=$(token reed-admin)
CONNECTORS=$(jq -r '.participants[] | select(.connector) | .connector.name' "$ROSTER")
conn_of() { jq -r --arg b "$1" '.participants[] | select(.bpn==$b) | .connector.name // empty' "$ROSTER"; }
owner_user() { jq -r --arg n "$1" '.participants[] | select(.connector.name==$n) | .users[0].username' "$ROSTER"; }
ids() { jq -c '[.dataset // [] | (if type=="array" then . else [.] end)[] | ."@id"] | sort'; }
offer_for() { jq -c --arg a "$1" '[.dataset // [] | (if type=="array" then . else [.] end)[] | select(."@id"==$a)][0].hasPolicy[0] // empty'; }

if [[ -z ${SCENARIO:-} ]]; then
  MATRIX=$(api "$ADMIN" GET /reed/policy/matrix)
  [[ $(status) == 200 ]] || { fail "policy matrix: $(status)"; exit 1; }

  log "1. catalogue: $(wc -w <<<"$CONNECTORS") connectors x every other connector"
  declare -A CATS
  for c in $CONNECTORS; do
    ok=0; bad=""
    for p in $CONNECTORS; do
      [[ $c == "$p" ]] && continue
      CATS[$c/$p]=$(catalog "$c" "$p")
      got=$(ids <<<"${CATS[$c/$p]}")
      want=$(jq -c --arg o "$(bpn_of "$p")" --arg c "$c" \
        '[.[] | select(.ownerBpn==$o) | select(any(.access[]; .connector==$c and .visible)) | .assetId] | sort' <<<"$MATRIX")
      if [[ $got == "$want" ]]; then ok=$((ok + 1)); else bad+=" $p(got $got, predicted $want)"; fi
    done
    [[ -z $bad ]] && pass "$c sees exactly what its credentials allow in all $ok catalogues" || fail "$c:$bad"
  done

  log "2. contracts: one negotiation per company pair and distinct contract policy"
  # one asset per (consumer, owner, contract terms): same terms from the same owner decide the same way
  CASES=$(jq -r '.[] | . as $a | .access[] | select(.visible)
                 | [.connector, $a.ownerBpn, ($a.contractTerms | join(";")), $a.assetId, (if .granted then "FINALIZED" else "TERMINATED" end), .contractReason]
                 | @tsv' <<<"$MATRIX" | sort -t$'\t' -k1,3 -u)
  total=0; agree=0
  while IFS=$'\t' read -r c owner terms asset want reason; do
    p=$(conn_of "$owner"); total=$((total + 1))
    neg=$(negotiate "$c" "$p" "$asset" "$(offer_for "$asset" <<<"${CATS[$c/$p]}")")
    got=$(jq -r .state <<<"$neg")
    if [[ $got == "$want" ]]; then agree=$((agree + 1))
    else fail "$c -> $asset: connector $got, REED predicted $want ($reason) $(jq -r '.errorDetail // ""' <<<"$neg" | grep -o "Constraint '[^']*'" | head -1)"; fi
  done <<<"$CASES"
  [[ $agree == "$total" ]] && pass "all $total negotiations decided as predicted ($(grep -c FINALIZED <<<"$CASES") contracts, $(grep -c TERMINATED <<<"$CASES") refusals)"
fi

log "3. cross-border scenarios (deployment/scenarios/interop.json)"
SCEN=$(jq -c --arg s "${SCENARIO:-}" '.scenarios[] | select($s == "" or .id == $s)' "$ROOT/deployment/scenarios/interop.json")
while IFS= read -r s; do
  id=$(jq -r .id <<<"$s"); owner=$(jq -r .owner <<<"$s"); asset=$(jq -r .asset <<<"$s"); terms=$(jq -c .terms <<<"$s")
  log "$id $(jq -r .title <<<"$s")"
  OT=$(token "$(owner_user "$owner")")
  before=$(api "$OT" GET /reed/policy/access | jq -c --arg a "$asset" '.[] | select(.assetId==$a) | {discoverability, policyTemplate}')
  if [[ $terms != null ]]; then
    api "$OT" PUT "/reed/assets/$asset/policy" "$terms" >/dev/null
    [[ $(status) == 200 ]] && echo "  $owner set $asset to $(jq -r '"\(.discoverability) / \(.policyTemplate)"' <<<"$terms")" \
      || { fail "$id: owner could not set terms ($(status))"; continue; }
  fi
  now=$(jq -c '.terms // empty' <<<"$s"); now=${now:-$before}
  preview=$(api "$OT" GET "/reed/policy/preview?assetId=$asset&discoverability=$(jq -r .discoverability <<<"$now")&policyTemplate=$(jq -r .policyTemplate <<<"$now")")
  while IFS= read -r r; do
    c=$(jq -r .consumer <<<"$r"); want=$(jq -r .expect <<<"$r"); reason=$(jq -r '.reason // ""' <<<"$r")
    predicted=$(jq -r --arg c "$c" '.access[] | select(.connector==$c) | if .visible|not then "HIDDEN" elif .granted then "FINALIZED" else "TERMINATED" end' <<<"$preview")
    offer=$(catalog "$c" "$owner" | offer_for "$asset")
    if [[ -z $offer ]]; then got=HIDDEN; detail=""
    else neg=$(negotiate "$c" "$owner" "$asset" "$offer"); got=$(jq -r .state <<<"$neg"); detail=$(jq -r '.errorDetail // ""' <<<"$neg"); fi
    label="$c ($(jq -r --arg c "$c" '.participants[] | select(.connector.name==$c) | .country' "$ROSTER")) -> $got"
    if [[ $got != "$want" ]]; then fail "$label, story expects $want"
    elif [[ $predicted != "$want" ]]; then fail "$label, but REED's preview predicted $predicted"
    elif [[ -n $reason && $detail != *"$reason"* ]]; then fail "$label, but the refusal does not name $reason: ${detail:0:200}"
    else pass "$label${reason:+ on $reason}"; fi
    keys=$(jq -c '.pull // empty' <<<"$r")
    if [[ -n $keys && $got == FINALIZED ]]; then
      payload=$(pull "$c" "$owner" "$(jq -r .contractAgreementId <<<"$neg")")
      missing=$(jq -r --argjson k "$keys" '[$k[] as $x | select(has($x) | not) | $x] | join(",")' <<<"$payload")
      [[ -z $missing ]] && pass "$c pulled $asset: $(jq -c --argjson k "$keys" 'with_entries(select(.key as $x | $k | index($x))) | map_values(if type=="object" then (keys | join(",")) else . end)' <<<"$payload" | head -c 220)" \
        || fail "$c's payload lacks $missing"
    fi
  done < <(jq -c '.requests[]' <<<"$s")
  if [[ $terms != null && $terms != "$before" ]]; then
    api "$OT" PUT "/reed/assets/$asset/policy" "$before" >/dev/null
    [[ $(status) == 200 ]] || fail "$id: could not restore $asset to $before"
  fi
done <<<"$SCEN"

log "done"
exit $FAILED
