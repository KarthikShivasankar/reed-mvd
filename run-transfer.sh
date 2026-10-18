#!/usr/bin/env bash
#
# End-to-end EDC check under DCP (verifiable-credential policies), between real participants:
#
#   positive  Nordvind (OEM) -> Castellum's confidential ProcessCapability (contract policy: role OEM)
#             catalog -> negotiation FINALIZED -> HttpData-PULL transfer -> EDR -> pull payload
#             -> the REED audit trail shows the PULL
#   negative  Castellum (SUPPLIER) negotiating Wisła's ProcessCapability (OEM only) -> TERMINATED
#   negative  Hanse (no supply relation to Nordvind) cannot even see Nordvind's bilateral BOM
#
# Overrides: CONSUMER, PROVIDER, ASSET_ID (positive case).
# Usage: ./run-transfer.sh   (after ./seed-identity.sh and ./seed-reed.sh). Exit code 0 = all PASS.
set -euo pipefail
LOG_TAG=run
source "$(dirname "$0")/tools/reed-lib.sh"

CONSUMER="${CONSUMER:-nordvind}"
PROVIDER="${PROVIDER:-castellum}"
ASSET_ID="${ASSET_ID:-process-capability-$PROVIDER}"

offer_for() { jq -c --arg a "$1" '[.dataset // [] | (if type=="array" then . else [.] end)[] | select(."@id"==$a)][0].hasPolicy[0] // empty'; }

# ---------- positive: OEM buys a supplier's confidential capability ----------
log "1. $CONSUMER requests the catalog of $PROVIDER (presenting its MembershipCredential)"
CAT=$(catalog "$CONSUMER" "$PROVIDER")
echo "$CAT" | jq -c '[.dataset // [] | (if type=="array" then . else [.] end)[] | ."@id"]'
OFFER=$(offer_for "$ASSET_ID" <<<"$CAT")
[[ -n $OFFER ]] && pass "$ASSET_ID offered to $CONSUMER" || { fail "$ASSET_ID not in catalog"; exit 1; }

log "2. negotiating (provider evaluates the CEL policy against $CONSUMER's credentials)"
NEG=$(negotiate "$CONSUMER" "$PROVIDER" "$ASSET_ID" "$OFFER")
AGR=$(jq -r '.contractAgreementId // empty' <<<"$NEG")
[[ $(jq -r .state <<<"$NEG") == FINALIZED ]] && pass "negotiation FINALIZED, agreement $AGR" \
  || { fail "negotiation: $(jq -c '{state, errorDetail}' <<<"$NEG")"; exit 1; }

log "3. HttpData-PULL transfer -> EDR -> pull the confidential payload through $PROVIDER's data plane"
PAYLOAD=$(pull "$CONSUMER" "$PROVIDER" "$AGR")
echo "$PAYLOAD" | jq .
[[ $(jq -r .assetClass <<<"$PAYLOAD") == ProcessCapability ]] && pass "confidential payload received" || fail "payload: $PAYLOAD"

log "4. REED audit trail (usage layer)"
AUDIT=$(api "$(token reed-admin)" GET /reed/audit)
jq --arg a "$ASSET_ID" '[.[] | select(.assetId == $a and .eventType == "PULL")] | .[0]' <<<"$AUDIT"
CONSUMER_BPN=$(bpn_of "$CONSUMER")
[[ $(jq -r --arg a "$ASSET_ID" '[.[] | select(.assetId == $a and .eventType == "PULL")][0].detail' <<<"$AUDIT") == *"by $CONSUMER_BPN"* ]] \
  && pass "PULL recorded, naming the consumer ($CONSUMER_BPN)" || fail "no PULL audit event naming $CONSUMER_BPN"

# ---------- negative: credentials decide ----------
log "5. castellum (role SUPPLIER) negotiates wisla's ProcessCapability (contract policy: role OEM)"
WCAT=$(catalog castellum wisla)
WOFFER=$(offer_for process-capability-wisla <<<"$WCAT")
NEG=$(negotiate castellum wisla process-capability-wisla "$WOFFER")
[[ $(jq -r .state <<<"$NEG") == TERMINATED ]] \
  && pass "TERMINATED: $(jq -r .errorDetail <<<"$NEG" | grep -o 'Policy in scope[^]]*]' | head -1)" \
  || fail "expected TERMINATED, got $(jq -c '{state, errorDetail}' <<<"$NEG")"

log "6. hanse (no SupplierRelationCredential naming Nordvind) asks for nordvind's catalog"
HCAT=$(catalog hanse nordvind)
ids=$(jq -c '[.dataset // [] | (if type=="array" then . else [.] end)[] | ."@id"] | sort' <<<"$HCAT")
echo "  hanse sees: $ids"
[[ $ids != *bill-of-material-nordvind* ]] && pass "bilateral BOM hidden from hanse by the access policy" \
  || fail "hanse can see the bilateral BOM"
CCAT=$(catalog castellum nordvind)
[[ $(jq -c '[.dataset // [] | (if type=="array" then . else [.] end)[] | ."@id"]' <<<"$CCAT") == *bill-of-material-nordvind* ]] \
  && pass "castellum (supplies Nordvind) does see the bilateral BOM" || fail "castellum cannot see the BOM"

log "done"
exit $FAILED
