#!/usr/bin/env bash
#
# Seeds the DCP identity layer from deployment/roster.json (idempotent; 409 = exists):
#   1. the REED issuer tenant in the Issuer Service
#   2. "database" attestation definitions over the REED registry views (vc_*)
#   3. credential definitions: MembershipCredential, CertificationCredential, SupplierRelationCredential
#   4. a holder in the issuer + a participant context in the member's OWN IdentityHub (DID document
#      with CredentialService and ProtocolEndpoint) for every member with a connector and the
#      federated-catalog operator
#   5. credential requests, waiting until every credential is ISSUED
#
# Usage: ./seed-identity.sh        (after `docker compose -f deployment/docker-compose.yml up -d`)
set -euo pipefail
LOG_TAG=identity
source "$(dirname "$0")/tools/reed-lib.sh"

ih()     { echo "http://localhost:$1081/api/identity/v1alpha"; }        # ih <port prefix>
ih_key() { local v="IH_KEY_$(echo "$1" | tr 'a-z-' 'A-Z_')"; echo "${!v}"; }  # ih_key <name>
IS_ID="${IS_ID:-http://localhost:10015/api/identity/v1alpha}"
IS_ADMIN="${IS_ADMIN:-http://localhost:10013/api/admin/v1alpha/participants/issuer}"
ISSUER_DID='did:web:issuerservice%3A10016:issuer'

post() { # post <url> <json> [api key, default: the issuer's]
  local out code
  out=$(curl -sS -w '\n%{http_code}' -X POST "$1" -H "x-api-key: ${3:-$ISSUER_KEY}" -H 'Content-Type: application/json' -d "$2")
  code=$(tail -n1 <<<"$out")
  [[ $code == 2* || $code == 409 ]] || { echo "FAILED $code POST $1: $(sed '$d' <<<"$out")" >&2; exit 1; }
  printf '  %s %s\n' "$code" "${1##*/v1alpha}"
}

wait_for "Issuer Service" "$IS_ID/participants" "x-api-key: $ISSUER_KEY"

log "1. issuer tenant"
post "$IS_ID/participants" '{
  "participantContextId": "issuer", "did": "'"$ISSUER_DID"'", "active": true, "roles": ["admin"],
  "serviceEndpoints": [{"id": "issuer-service-1", "type": "IssuerService",
     "serviceEndpoint": "http://issuerservice:10012/api/issuance/v1alpha/participants/issuer"}],
  "key": {"keyId": "'"$ISSUER_DID"'#key-1", "privateKeyAlias": "'"$ISSUER_DID"'#key-1",
          "keyGeneratorParams": {"algorithm": "EdDSA"}}}'

log "2. attestation definitions (database views in the REED registry)"
for t in membership certification supplier_relation; do
  post "$IS_ADMIN/attestations" '{"id": "'$t'-attestation", "attestationType": "database",
    "configuration": {"dataSourceName": "reed", "tableName": "vc_'$t'", "idColumn": "holder_id", "required": true}}'
done

log "3. credential definitions"
creddef() { # creddef <id> <type> <attestation> <claim...>
  local id=$1 type=$2 att=$3; shift 3
  local maps; maps=$(for k in "$@"; do printf '{"input":"%s","output":"credentialSubject.%s","required":true},' "$k" "$k"; done | sed 's/,$//')
  post "$IS_ADMIN/credentialdefinitions" '{"id": "'$id'", "credentialType": "'$type'",
    "attestations": ["'$att'"], "mappings": ['"$maps"'], "rules": [],
    "jsonSchema": "{}", "jsonSchemaUrl": "https://w3id.org/reed/schema/'$type'.json",
    "format": "VC1_0_JWT", "validity": "2592000"}'
}
creddef membership-credential-def        MembershipCredential       membership-attestation        bpn role membership organisation country
creddef certification-credential-def     CertificationCredential    certification-attestation     bpn certifications
creddef supplier-relation-credential-def SupplierRelationCredential supplier_relation-attestation bpn partners projects

# Members that need a DID: every connector, plus identity-only members (the FC operator).
mapfile -t IDS < <(jq -r '.participants[] | select((.consortium // true) and (.connector or .identity))
                     | "\(.connector.name // .identity) \(.connector.portPrefix // "39") \(.name)"' "$ROSTER")

log "4. holders + participant contexts, each in the member's own IdentityHub"
for row in "${IDS[@]}"; do
  read -r n px name <<<"$row"
  wait_for "IdentityHub of $n" "$(ih "$px")/participants" "x-api-key: $(ih_key "$n")"
  post "$IS_ADMIN/holders" '{"holderId": "'"$(did_of "$n")"'", "did": "'"$(did_of "$n")"'", "name": "'"$name"'"}'
  post "$(ih "$px")/participants" '{
    "participantContextId": "'"$n"'", "did": "'"$(did_of "$n")"'", "active": true, "roles": [],
    "serviceEndpoints": [
      {"id": "'"$n"'-credentialservice", "type": "CredentialService",
       "serviceEndpoint": "http://'"$n"'-ih:7082/api/credentials/v1/participants/'"$n"'"},
      {"id": "'"$n"'-dsp", "type": "ProtocolEndpoint", "serviceEndpoint": "http://'"$n"':'"$px"'194/protocol/2025-1"}],
    "key": {"keyId": "'"$(did_of "$n")"'#key-1", "privateKeyAlias": "'"$n"'-did-key",
            "keyGeneratorParams": {"algorithm": "EC"}}}' "$(ih_key "$n")"
done

log "5. credential requests (IdentityHub -> Issuer Service over DCP)"
# A credential counts only when it is ISSUED (state 500); anything else - never requested, or moved
# to ERROR because the issuer's status list was unreachable - is requested again.
spec() { echo '{"format":"VC1_0_JWT","type":"'$1'","id":"'$2'"}'; }
ALL="$(spec MembershipCredential membership-credential-def),$(spec CertificationCredential certification-credential-def),$(spec SupplierRelationCredential supplier-relation-credential-def)"
issued() { curl -fsS -H "x-api-key: $(ih_key "$1")" "$(ih "$2")/participants/$1/credentials" | jq '[.[] | select(.state == 500)] | length'; }
RUN=$(date +%s)
declare -A PENDING=()
for row in "${IDS[@]}"; do
  read -r n px _ <<<"$row"
  if [[ $(issued "$n" "$px") -ge 3 ]]; then echo "  $n already holds 3 issued credentials"; continue; fi
  post "$(ih "$px")/participants/$n/credentials/request" \
    '{"issuerDid": "'"$ISSUER_DID"'", "holderPid": "'"$n-req-$RUN"'", "credentials": ['"$ALL"']}' "$(ih_key "$n")"
  PENDING[$n]=$px
done

log "6. waiting for ISSUED"
for n in "${!PENDING[@]}"; do
  px=${PENDING[$n]}
  st=""
  for _ in $(seq 1 60); do
    st=$(curl -fsS -H "x-api-key: $(ih_key "$n")" "$(ih "$px")/participants/$n/credentials/request/$n-req-$RUN" 2>/dev/null | jq -r '.status // empty' || true)
    [[ $st == ISSUED ]] && break
    [[ $st == ERROR || $st == REJECTED ]] && { echo "$n credential request $st" >&2; exit 1; }
    sleep 2
  done
  [[ $st == ISSUED ]] || { echo "$n credentials not issued ($st)" >&2; exit 1; }
done
for row in "${IDS[@]}"; do
  read -r n px _ <<<"$row"
  echo "  $n: $(curl -fsS -H "x-api-key: $(ih_key "$n")" "$(ih "$px")/participants/$n/credentials" \
    | jq -c '[.[] | select(.state == 500) | .verifiableCredential.credential.type[-1]] | sort')"
  [[ $(issued "$n" "$px") -ge 3 ]] || { echo "$n holds fewer than 3 issued credentials" >&2; exit 1; }
done
log "identity layer ready: ${#IDS[@]} DIDs with verifiable credentials"
