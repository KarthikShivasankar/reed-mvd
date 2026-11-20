#!/usr/bin/env bash
#
# Policy-aware matchmaking, contracting and decentralised enforcement, end to end (docs/policy-enforcement.md):
#
#   design time   Nordic Manufacturing Provider's capability "Precision CNC Manufacturing" carries a compound ODRL policy:
#                 OEM AND active member AND EU/EEA AND not a competitor AND pilot project
#   matchmaking   Hanse (Buyer A): capability TRUE, policy TRUE  -> eligible
#                 Nordvind (Buyer B): capability TRUE, policy FALSE (competitor) -> not eligible, cannot select
#   contract      Hanse selects, accepts, the connectors negotiate; the effective policy (ODRL) is translated to Rego
#                 and deployed to Nordic's own Open Policy Agent -> ACTIVE
#   runtime       Nordic's data service (enforcement point) asks Nordic's OPA for every pull:
#                 ALLOW for Hanse with the agreed purpose; DENY for another purpose, for Nordvind (who got an EDC
#                 agreement directly at the connector), after a suspension, after termination
#   audit         every decision is in the decision log with each condition's outcome
#
# Usage: ./run-policy.sh   (after ./seed-identity.sh and ./seed-reed.sh). Exit code 0 = all PASS.
set -euo pipefail
LOG_TAG=policy
source "$(dirname "$0")/tools/reed-lib.sh"

OFFERING=precision-cnc-nordic
ASSET=production-status-nordic
ADMIN=$(token reed-admin); HANSE=$(token hanse-buyer); NORDVIND=$(token nordvind-buyer); NORDIC=$(token nordic-engineer)
HANSE_BPN=$(bpn_of hanse)

check() { # check <description> <actual> <expected>
  [[ $2 == "$3" ]] && pass "$1" || fail "$1: expected '$3', got '$2'"
}
offer_for() { jq -c --arg a "$1" '[.dataset // [] | (if type=="array" then . else [.] end)[] | select(."@id"==$a)][0].hasPolicy[0] // empty'; }
# get <edr-json> [purpose] -> body; HTTP status via $(status)
get() {
  local out; out=$(curl -sS -w '\n%{http_code}' "$(jq -r .endpoint <<<"$1")${2:+?purpose=$2}" -H "Authorization: $(jq -r .authorization <<<"$1")")
  tail -n1 <<<"$out" >"$STATUS_FILE"; sed '$d' <<<"$out"
}
last_decision() { api "$ADMIN" GET /reed/policy-decisions | jq -c --arg r "$1" '[.[] | select(.requesterBpn == $r and .outcome.stage == "RUNTIME")][0]'; }
failed_kinds() { jq -r '[.outcome.failed[].kind] | sort | join(",")'; }
restore() { api "$ADMIN" POST "/reed/onboarding/$HANSE_BPN/status" '{"status":"ACTIVE"}' >/dev/null || true; rm -f "$STATUS_FILE"; }
trap restore EXIT

# contracts left open by an earlier, interrupted run would (rightly) keep covering Buyer A
open_contracts() { api "$HANSE" GET /reed/contracts | jq -r --arg o $OFFERING '.[] | select(.offeringId == $o and (.status | IN("DRAFT","NEGOTIATING","AGREED","ACTIVE"))) | .id'; }
for c in $(open_contracts); do api "$HANSE" POST "/reed/contracts/$c/terminate" >/dev/null; done

# ---------- 1. onboarding: the attributes policies are evaluated against ----------
log "1. the operator onboards a company; its attributes decide what it is eligible for"
api "$HANSE" POST /reed/onboarding '{"name":"x","role":"OEM","country":"DE"}' >/dev/null
check "only the operator onboards companies" "$(status)" 403
BALTIC=$(api "$ADMIN" GET /reed/participants | jq -r '[.[] | select(.name == "Baltic Gearworks OÜ")][0].bpn // empty')
if [[ -z $BALTIC ]]; then
  BALTIC=$(api "$ADMIN" POST /reed/onboarding '{"name":"Baltic Gearworks OÜ","shortName":"Baltic","role":"OEM","country":"EE","city":"Tartu","industry":"machining"}' | jq -r .bpn)
  check "company registered" "$(status)" 201
fi
api "$ADMIN" POST "/reed/onboarding/$BALTIC/status" '{"status":"PENDING"}' >/dev/null
api "$ADMIN" PUT "/reed/onboarding/$BALTIC" '{"competitorClasses":["precision-machining"],"verified":true}' >/dev/null
sim() { api "$ADMIN" POST /reed/policy-decisions/simulate '{"offeringId":"'$OFFERING'","requesterBpn":"'"$BALTIC"'","purpose":"pilot-evaluation"}'; }
check "PENDING and a competitor: two conditions fail" "$(sim | jq -r '[.failed[].kind] | sort | join(",")')" "COMPETITOR,MEMBERSHIP"
api "$ADMIN" POST "/reed/onboarding/$BALTIC/status" '{"status":"ACTIVE"}' >/dev/null
check "ACTIVE member, still a competitor: one condition fails" "$(sim | jq -r '[.failed[].kind] | join(",")')" "COMPETITOR"
api "$ADMIN" PUT "/reed/onboarding/$BALTIC" '{"competitorClasses":[]}' >/dev/null
check "no longer classed as competitor: eligible" "$(sim | jq -r .decision)" ALLOW
api "$ADMIN" POST "/reed/onboarding/$BALTIC/status" '{"status":"PENDING"}' >/dev/null

log "   registered connectors and their policy decision points"
CONN=$(api "$ADMIN" GET /reed/operator/connectors)
jq -r '.[] | "   \(.connector)\tconnector \(if .online then "online" else "OFFLINE" end)\tOPA \(if .decisionPointOnline then "online" else "OFFLINE" end)"' <<<"$CONN"
check "every connector and its Open Policy Agent answer" "$(jq -r '[.[] | select(.online and .decisionPointOnline)] | length' <<<"$CONN")" "$(jq length <<<"$CONN")"
check "an OPA does not answer without a token" "$(docker exec reed-backend curl -s -o /dev/null -w '%{http_code}' http://nordic-opa:8181/v1/policies)" 401

# ---------- 2. capability + compound policy ----------
log "2. the provider's capability and its compound ODRL policy"
O=$(api "$HANSE" GET "/reed/offerings/$OFFERING")
jq -r '"   \(.name) by \(.provider): \(.resource)\n   \(.policy.effective)"' <<<"$O"
check "five policy components, combined with AND" "$(jq -r '[(.policy.components | length), (.policy.odrl.permission[0].constraint.and | length)] | join("/")' <<<"$O")" "5/5"
check "the policy is translated to Rego" "$(jq -r '.policy.rego | test("package reed.policy.p_offering_precision_cnc_nordic")' <<<"$O")" true
api "$NORDIC" POST /reed/policies/translate '{"policy":[{"leftOperand":"odrl:spatial","operator":"eq","rightOperand":"EU"}]}' >/dev/null
check "a constraint REED cannot translate is rejected, not ignored" "$(status)" 400
api "$HANSE" PUT "/reed/offerings/$OFFERING/policy" '{"policy":[]}' >/dev/null
check "another company cannot change the provider's policy" "$(status)" 404

TWIN=$(api "$NORDIC" GET /reed/offerings | jq -r '[.[] | select(.name == "Digital-twin simulation of the CNC cell")][0].id // empty')
TWIN_POLICY='{"policy":[{"leftOperand":"MembershipCredential","operator":"eq","rightOperand":"active"},{"leftOperand":"odrl:purpose","operator":"isAnyOf","rightOperand":"research,pilot-evaluation"}]}'
if [[ -z $TWIN ]]; then
  TWIN=$(api "$NORDIC" POST /reed/offerings '{"name":"Digital-twin simulation of the CNC cell","capability":"digital-twin-simulation","resourceKind":"DIGITAL_TWIN",
    "resource":"Cell simulation model","description":"Kinematic and thermal model of the 5-axis cell","keywords":["simulation","5-axis"],"capacityPerMonth":50,
    "policy":'"$(jq -c .policy <<<"$TWIN_POLICY")"'}' | jq -r .id)
  check "the provider registers a second capability" "$(status)" 201
fi
api "$NORDIC" PUT "/reed/offerings/$TWIN/policy" "$TWIN_POLICY" >/dev/null
check "published with a two-condition policy" "$(api "$NORDIC" POST "/reed/offerings/$TWIN/publish" | jq -r '[.published, (.policy.components | length)] | join("/")')" "true/2"

# ---------- 3. RFQ + policy-aware matchmaking ----------
START=$(date -u +%F); END=$(date -u -d '+60 days' +%F)
RFQ='{"title":"Pilot batch: precision housings","capability":"cnc-machining","keywords":["5-axis","titanium"],"requiredCapacity":120,
  "preferredRegion":"EEA","startDate":"'$START'","endDate":"'$END'","purpose":"pilot-evaluation"}'
log "3. Buyer A (Hanse) and Buyer B (Nordvind) post the same service RFQ"
RA=$(api "$HANSE" POST /reed/service-rfqs "$RFQ" | jq -r .id)
RB=$(api "$NORDVIND" POST /reed/service-rfqs "$RFQ" | jq -r .id)
MA=$(api "$HANSE" GET "/reed/rfqs/$RA/service-matches" | jq -c --arg o $OFFERING '[.[] | select(.offering.id == $o)][0]')
MB=$(api "$NORDVIND" GET "/reed/rfqs/$RB/service-matches" | jq -c --arg o $OFFERING '[.[] | select(.offering.id == $o)][0]')
for m in "$MA" "$MB"; do jq -r '"   capability match \(.capabilityMatch)  policy eligible \(.policyEligible)  final \(.eligible)   \(.policy.explanation)"' <<<"$m"; done
check "Buyer A: capability TRUE, policy TRUE, eligible TRUE" "$(jq -r '[.capabilityMatch, .policyEligible, .eligible] | join(",")' <<<"$MA")" "true,true,true"
check "Buyer B: capability TRUE, policy FALSE, eligible FALSE" "$(jq -r '[.capabilityMatch, .policyEligible, .eligible] | join(",")' <<<"$MB")" "true,false,false"
check "Buyer B fails exactly one condition" "$(jq -r '[.policy.failed[].label] | join(";")' <<<"$MB")" "Requester is not a competing organisation"
check "a capability that does not match is not asked about policy" "$(api "$HANSE" GET "/reed/rfqs/$RA/service-matches" | jq -r --arg o "$TWIN" '[.[] | select(.offering.id == $o)][0] | [.capabilityMatch, (.policy == null)] | join(",")')" "false,true"
api "$NORDVIND" GET "/reed/rfqs/$RA/service-matches" >/dev/null
check "only the buyer sees who is eligible for its RFQ" "$(status)" 403

# ---------- 4. selection + contract ----------
log "4. selection and contract formation"
api "$NORDVIND" POST /reed/contracts '{"rfqId":"'"$RB"'","offeringId":"'$OFFERING'"}' | jq -r '"   Buyer B: \(.message // .error)"'
check "Buyer B cannot select the provider" "$(status)" 409
C=$(api "$HANSE" POST /reed/contracts '{"rfqId":"'"$RA"'","offeringId":"'$OFFERING'"}')
CID=$(jq -r .id <<<"$C")
check "Buyer A selects: contract DRAFT" "$(jq -r .status <<<"$C")" DRAFT
jq -r '"   \(.policy.effective)"' <<<"$C"
check "effective policy: offering policy AND buyer AND period AND purpose" "$(jq -r '[.policy.odrl."@type", (.policy.odrl.permission[0].constraint.and | length)] | join("/")' <<<"$C")" "Agreement/9"
check "nothing is deployed before the contract is agreed" "$(jq -r '.deployedTo // "none"' <<<"$C")" none
check "terms accepted: NEGOTIATING" "$(api "$HANSE" POST "/reed/contracts/$CID/accept" | jq -r .status)" NEGOTIATING
NEG=$(negotiate hanse nordic $ASSET "$(catalog hanse nordic | offer_for $ASSET)")
AGR=$(jq -r '.contractAgreementId // empty' <<<"$NEG")
check "connectors negotiate (CEL: OEM, member, EU/EEA)" "$(jq -r .state <<<"$NEG")" FINALIZED
C=$(api "$HANSE" POST "/reed/contracts/$CID/agreed" '{"agreementId":"'"$AGR"'"}')
check "agreement verified, Rego deployed to the provider's own OPA: ACTIVE" "$(jq -r '[.status, .deployedTo] | join(" ")' <<<"$C")" "ACTIVE http://nordic-opa:8181"

# ---------- 5. runtime enforcement ----------
log "5. runtime: Nordic's data service asks Nordic's Open Policy Agent before any payload leaves"
EDR=$(edr hanse nordic "$AGR")
P=$(get "$EDR" pilot-evaluation)
check "Buyer A, agreed purpose: 200" "$(status)" 200
check "machine availability delivered under a licence" "$(jq -r '[(.shopFloor != null), ._reedLicense.licensee] | join(",")' <<<"$P")" "true,$HANSE_BPN"
D=$(last_decision "$HANSE_BPN"); jq -r '"   \(.outcome.explanation)"' <<<"$D"
check "logged: ALLOW by Nordic's OPA under the contract's policy" "$(jq -r '[.outcome.decision, .outcome.decidedBy, .contractId] | join(" ")' <<<"$D")" "ALLOW http://nordic-opa:8181 $CID"

check "the licence on the payload ends with the contract" "$(jq -r '._reedLicense.expiresAt[0:10]' <<<"$P")" "$(date -u -d "$END +1 day" +%F)"
R2=$(api "$HANSE" POST /reed/service-rfqs "$RFQ" | jq -r .id)
api "$HANSE" POST /reed/contracts '{"rfqId":"'"$R2"'","offeringId":"'$OFFERING'"}' >/dev/null   # a second, unconcluded draft
get "$EDR" pilot-evaluation >/dev/null
check "a newer draft does not shadow the active contract: still 200" "$(status)/$(last_decision "$HANSE_BPN" | jq -r .contractId)" "200/$CID"

get "$EDR" resale | jq -r '"   \(.reason)"'
check "Buyer A, another purpose: 403" "$(status)" 403
check "logged: DENY, the purpose condition failed" "$(last_decision "$HANSE_BPN" | failed_kinds)" PURPOSE
get "$EDR" >/dev/null
check "Buyer A, no purpose declared: 403" "$(status)" 403

log "   Buyer B bypasses the marketplace and negotiates directly at Nordic's connector"
NEGB=$(negotiate nordvind nordic $ASSET "$(catalog nordvind nordic | offer_for $ASSET)")
check "the connector's credential check passes (an OEM, a member, in the EEA)" "$(jq -r .state <<<"$NEGB")" FINALIZED
EDRB=$(edr nordvind nordic "$(jq -r .contractAgreementId <<<"$NEGB")")
get "$EDRB" pilot-evaluation | jq -r '"   \(.reason)"'
check "but the payload does not leave: 403" "$(status)" 403
check "logged: DENY - a competitor, no REED contract, so no pilot either" "$(last_decision "$(bpn_of nordvind)" | failed_kinds)" "COMPETITOR,CONTRACT,PILOT"

log "   the operator suspends Buyer A's membership"
api "$ADMIN" POST "/reed/onboarding/$HANSE_BPN/status" '{"status":"SUSPENDED"}' >/dev/null
get "$EDR" pilot-evaluation >/dev/null
check "suspended member: 403 although its credential and contract still exist" "$(status)/$(last_decision "$HANSE_BPN" | failed_kinds)" "403/MEMBERSHIP"
restore
get "$EDR" pilot-evaluation >/dev/null
check "membership restored: 200" "$(status)" 200

# ---------- 6. simulated requests, lifecycle, audit ----------
log "6. simulated requests, policy lifecycle and audit"
HANSE=$(token hanse-buyer)
S=$(api "$HANSE" POST /reed/policy-decisions/simulate '{"contractId":"'"$CID"'","purpose":"pilot-evaluation","at":"'"$(date -u -d '+90 days' +%FT%TZ)"'"}')
check "simulated request after the contract period: DENY" "$(jq -r '[.decision, ([.failed[].kind] | sort | join(","))] | join(" ")' <<<"$S")" "DENY CONTRACT,TIME"
check "simulated request inside the period: ALLOW" "$(api "$HANSE" POST /reed/policy-decisions/simulate '{"contractId":"'"$CID"'","purpose":"pilot-evaluation"}' | jq -r .decision)" ALLOW
V=$(api "$ADMIN" GET "/reed/contracts/$CID")
jq -r '.lifecycle[] | "   \(if .at then "x" else " " end) \(.label): \(.detail)"' <<<"$V"
check "the policy's way from definition to exchange is complete" "$(jq -r '[.lifecycle[] | select(.at == null)] | length' <<<"$V")" 0
check "a third company sees neither the contract nor its decisions" \
  "$(api "$(token wisla-engineer)" GET "/reed/contracts/$CID" >/dev/null; status)/$(api "$(token wisla-engineer)" GET /reed/policy-decisions | jq --arg c "$CID" '[.[] | select(.contractId == $c)] | length')" "404/0"
check "the provider sees runtime decisions at its connector, but not who was (in)eligible for others' RFQs" \
  "$(api "$NORDIC" GET /reed/policy-decisions | jq -r '[([.[] | select(.outcome.stage == "RUNTIME")] | length > 0), ([.[] | select(.outcome.stage == "MATCH")] | length)] | join("/")')" "true/0"
api "$NORDIC" POST /reed/policies/translate '{"policy":[{"leftOperand":"SupplierRelationCredential.partner","operator":"eq","rightOperand":"'"$HANSE_BPN"'"}]}' >/dev/null
check "a relationship condition can only be about the provider itself" "$(status)" 400
AUDIT=$(api "$ADMIN" GET /reed/audit)
check "audit trail: onboarding, contract lifecycle, OPA-decided pulls" \
  "$(jq -r --arg a $ASSET '[([.[] | select(.eventType == "ONBOARD")] | length > 0), ([.[] | select(.eventType == "CONTRACT")] | length > 0), ([.[] | select(.eventType == "PULL" and .assetId == $a and (.detail | test("Open Policy Agent")))] | length > 0)] | join(",")' <<<"$AUDIT")" "true,true,true"

check "the buyer terminates the contract" "$(api "$HANSE" POST "/reed/contracts/$CID/terminate" | jq -r .status)" TERMINATED
for c in $(open_contracts); do api "$HANSE" POST "/reed/contracts/$c/terminate" >/dev/null; done   # the unconcluded draft
get "$EDR" pilot-evaluation >/dev/null
check "terminated contract: 403, the contract condition failed" "$(status)/$(last_decision "$HANSE_BPN" | failed_kinds)" "403/CONTRACT"

log "done"
exit $FAILED
