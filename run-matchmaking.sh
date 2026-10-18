#!/usr/bin/env bash
#
# Matchmaking end-to-end, driven by deployment/scenarios/matchmaking.json:
#
#   for each scenario RFQ (or SCENARIO=R1):
#     1. the buyer (logged in via Keycloak) posts the RFQ             POST /reed/rfqs
#     2. REED ranks suppliers; top + rejection reasons must match the fixture
#     3. partner recommendations (NDT, heavy-lift, ...) must match the fixture
#   for scenarios whose top supplier runs an EDC connector, the full lifecycle:
#     4. buyer shortlists -> supplier engineer accepts
#     5. buyer's connector negotiates the supplier's confidential ProcessCapability (DCP)
#        and pulls it via EDR
#     6. buyer confirms with the agreement id -> REED verifies it on the buyer's connector,
#        checks the confidential figures against the RFQ -> CONFIRMED
#   negative: a non-member's buyer cannot post an RFQ (403); a supplier sees only its own row.
#
# Usage: ./run-matchmaking.sh            all scenarios
#        SCENARIO=R1 ./run-matchmaking.sh
set -euo pipefail
LOG_TAG=match
source "$(dirname "$0")/tools/reed-lib.sh"
SCEN="$ROOT/deployment/scenarios/matchmaking.json"
ONLY="${SCENARIO:-}"

user_for() { # user_for <bpn> <role> -> username from the roster
  jq -r --arg b "$1" --arg r "$2" '.participants[] | select(.bpn==$b) | .users[] | select(.roles | index($r)) | .username' "$ROSTER" | head -1
}
connector_of() { jq -r --arg b "$1" '.participants[] | select(.bpn==$b) | .connector.name // empty' "$ROSTER"; }

for id in $(jq -r '.rfqs[].id' "$SCEN"); do
  [[ -n $ONLY && $id != "$ONLY" ]] && continue
  S=$(jq -c --arg id "$id" '.rfqs[] | select(.id==$id)' "$SCEN")
  BUYER=$(jq -r .buyer <<<"$S"); TOP=$(jq -r .expectedTop <<<"$S")
  log "$id $(jq -r .title <<<"$S")  [$(jq -r .chain <<<"$S")]"
  BT=$(token "$(user_for "$BUYER" buyer)")

  FORM=$(jq -c '{title: (.title + " (e2e)"), story, sector, partFamily, material, dimsMm, massKg, tolMm, quantity,
                 dueDate: (now + .dueInWeeks*7*86400 | strftime("%Y-%m-%d")), deliveryLat, deliveryLon,
                 requiredProcesses, requiredCerts, partnerProcesses}' <<<"$S")
  RFQ=$(api "$BT" POST /reed/rfqs "$FORM")
  [[ $(status) == 201 ]] || { fail "post RFQ -> $(status) $RFQ"; continue; }
  RID=$(jq -r .id <<<"$RFQ")

  M=$(api "$BT" GET "/reed/rfqs/$RID/matches")
  jq -r '.[] | "    \(if .rank > 0 then "#\(.rank)" else " - " end) \(.result.name) \(if .result.qualified then .result.score else ([.result.rejections[].code] | join(",")) end)"' <<<"$M"
  got=$(jq -r '.[0].result.bpn' <<<"$M")
  [[ $got == "$TOP" ]] && pass "top match $(jq -r '.[0].result.name' <<<"$M")" || fail "top match $got, expected $TOP"
  second=$(jq -r '.expectedSecond // empty' <<<"$S")
  if [[ -n $second ]]; then
    [[ $(jq -r '.[1].result.bpn' <<<"$M") == "$second" ]] && pass "runner-up as expected" || fail "runner-up $(jq -r '.[1].result.bpn' <<<"$M"), expected $second"
  fi
  for bpn in $(jq -r '.expectedRejections // {} | keys[]' <<<"$S"); do
    want=$(jq -c --arg b "$bpn" '.expectedRejections[$b] | sort' <<<"$S")
    have=$(jq -c --arg b "$bpn" '[.[] | select(.result.bpn==$b) | .result.rejections[].code] | unique' <<<"$M")
    [[ $(jq -n --argjson w "$want" --argjson h "$have" '$w - $h | length') == 0 ]] \
      && pass "$bpn rejected: $have" || fail "$bpn rejections $have, expected $want"
  done
  for proc in $(jq -r '.expectedPartners // {} | keys[]' <<<"$S"); do
    P=$(api "$BT" GET "/reed/rfqs/$RID/partners")
    want=$(jq -r --arg p "$proc" '.expectedPartners[$p]' <<<"$S")
    have=$(jq -r --arg p "$proc" '.[] | select(.process==$p) | .candidates[0].result.bpn' <<<"$P")
    [[ $have == "$want" ]] && pass "partner for $proc: $(jq -r --arg p "$proc" '.[] | select(.process==$p) | .candidates[0].result.name' <<<"$P")" \
      || fail "partner for $proc $have, expected $want"
  done

  BUYER_C=$(connector_of "$BUYER"); TOP_C=$(connector_of "$TOP")
  if [[ -z $TOP_C || -z $BUYER_C ]]; then
    echo "    (top supplier has no EDC connector yet - lifecycle stops at the ranking)"
    continue
  fi

  SH=$(api "$BT" POST "/reed/rfqs/$RID/shortlist/$TOP")
  MID=$(jq -r .id <<<"$SH")
  [[ $(jq -r .state <<<"$SH") == SHORTLISTED ]] && pass "shortlisted (match $MID)" || fail "shortlist: $SH"

  ST=$(token "$(user_for "$TOP" supplier-engineer)")
  OWN=$(api "$ST" GET "/reed/rfqs/$RID/matches")
  [[ $(jq 'length' <<<"$OWN") == 1 && $(jq -r '.[0].result.bpn' <<<"$OWN") == "$TOP" ]] \
    && pass "supplier sees only its own row" || fail "supplier sees $(jq length <<<"$OWN") rows"
  AC=$(api "$ST" POST "/reed/matches/$MID/accept")
  [[ $(jq -r .state <<<"$AC") == ACCEPTED ]] && pass "supplier accepted" || fail "accept: $AC"

  ASSET=$(jq -r .detailAssetId <<<"$AC")
  CAT=$(catalog "$BUYER_C" "$TOP_C")
  OFFER=$(jq -c --arg a "$ASSET" '[.dataset // [] | (if type=="array" then . else [.] end)[] | select(."@id"==$a)][0].hasPolicy[0] // empty' <<<"$CAT")
  NEG=$(negotiate "$BUYER_C" "$TOP_C" "$ASSET" "$OFFER")
  AGR=$(jq -r '.contractAgreementId // empty' <<<"$NEG")
  [[ -n $AGR ]] && pass "EDC contract $BUYER_C <- $TOP_C for $ASSET" || { fail "negotiation: $(jq -c '{state,errorDetail}' <<<"$NEG")"; continue; }
  DETAIL=$(pull "$BUYER_C" "$TOP_C" "$AGR")
  pass "confidential capability pulled: $(jq -c '{machines, cpk}' <<<"$DETAIL")"

  CF=$(api "$BT" POST "/reed/matches/$MID/confirm" "{\"agreementId\": \"$AGR\"}")
  [[ $(jq -r .state <<<"$CF") == CONFIRMED ]] && pass "match CONFIRMED: $(jq -r .note <<<"$CF")" || fail "confirm: $CF"
done

if [[ -z $ONLY ]]; then
  log "N1 non-member cannot post RFQs; supplier opportunities"
  VT=$(token vagant-buyer)
  api "$VT" POST /reed/rfqs '{"title":"x","sector":"wind","dimsMm":[1,1,1],"massKg":1,"dueDate":"2030-01-01","requiredProcesses":["welding"]}' >/dev/null
  [[ $(status) == 403 ]] && pass "vagant-buyer (non-member) -> 403" || fail "vagant-buyer -> $(status)"
  OPP=$(api "$(token wisla-engineer)" GET /reed/opportunities)
  pass "wisla-engineer sees $(jq length <<<"$OPP") open opportunities: $(jq -c '[.[].rfq.id] | unique' <<<"$OPP")"
fi
log "done"
exit $FAILED
