#!/usr/bin/env bash
#
# Seeds the DCP identity layer from deployment/roster.json (idempotent; 409 = exists):
#   1. the REED issuer tenant in the Issuer Service
#   2. "database" attestation definitions over the REED registry views (vc_*)
#   3. credential definitions: MembershipCredential, CertificationCredential, SupplierRelationCredential
#   4. a holder + an IdentityHub participant context (DID document with CredentialService and
#      ProtocolEndpoint) for every member with a connector (and the federated-catalog operator)
#   5. credential requests, waiting until every credential is ISSUED
#
# Usage: ./seed-identity.sh        (after `docker compose -f deployment/docker-compose.yml up -d`)
set -euo pipefail
LOG_TAG=identity
source "$(dirname "$0")/tools/reed-lib.sh"

IH="${IH:-http://localhost:7081/api/identity/v1alpha}"
IS_ID="${IS_ID:-http://localhost:10015/api/identity/v1alpha}"
IS_ADMIN="${IS_ADMIN:-http://localhost:10013/api/admin/v1alpha/participants/issuer}"
ISSUER_DID='did:web:issuerservice%3A10016:issuer'

post() { # post <url> <json>
  local out code
  out=$(curl -sS -w '\n%{http_code}' -X POST "$1" -H "x-api-key: $IH_SUPERUSER_KEY" -H 'Content-Type: application/json' -d "$2")
  code=$(tail -n1 <<<"$out")
  [[ $code == 2* || $code == 409 ]] || { echo "FAILED $code POST $1: $(sed '$d' <<<"$out")" >&2; exit 1; }
  printf '  %s %s\n' "$code" "${1##*/v1alpha}"
}

wait_for "IdentityHub" "$IH/participants" "x-api-key: $IH_SUPERUSER_KEY"
wait_for "Issuer Service" "$IS_ID/participants" "x-api-key: $IH_SUPERUSER_KEY"

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

log "4. holders + IdentityHub participant contexts"
for row in "${IDS[@]}"; do
  read -r n px name <<<"$row"
  post "$IS_ADMIN/holders" '{"holderId": "'"$(did_of "$n")"'", "did": "'"$(did_of "$n")"'", "name": "'"$name"'"}'
  post "$IH/participants" '{
    "participantContextId": "'"$n"'", "did": "'"$(did_of "$n")"'", "active": true, "roles": [],
    "serviceEndpoints": [
      {"id": "'"$n"'-credentialservice", "type": "CredentialService",
       "serviceEndpoint": "http://identityhub:7082/api/credentials/v1/participants/'"$n"'"},
      {"id": "'"$n"'-dsp", "type": "ProtocolEndpoint", "serviceEndpoint": "http://'"$n"':'"$px"'194/protocol/2025-1"}],
    "key": {"keyId": "'"$(did_of "$n")"'#key-1", "privateKeyAlias": "'"$(did_of "$n")"'#key-1",
            "keyGeneratorParams": {"algorithm": "EC"}}}'
done

log "5. credential requests (IdentityHub -> Issuer Service over DCP)"
spec() { echo '{"format":"VC1_0_JWT","type":"'$1'","id":"'$2'"}'; }
ALL="$(spec MembershipCredential membership-credential-def),$(spec CertificationCredential certification-credential-def),$(spec SupplierRelationCredential supplier-relation-credential-def)"
for row in "${IDS[@]}"; do
  read -r n _ _ <<<"$row"
  have=$(curl -fsS -H "x-api-key: $IH_SUPERUSER_KEY" "$IH/participants/$n/credentials" | jq 'length')
  if [[ $have -ge 3 ]]; then echo "  $n already holds $have credentials"; continue; fi
  post "$IH/participants/$n/credentials/request" \
    '{"issuerDid": "'"$ISSUER_DID"'", "holderPid": "'"$n"'-req-1", "credentials": ['"$ALL"']}'
done

log "6. waiting for ISSUED"
for row in "${IDS[@]}"; do
  read -r n _ _ <<<"$row"
  st=""
  for _ in $(seq 1 60); do
    st=$(curl -fsS -H "x-api-key: $IH_SUPERUSER_KEY" "$IH/participants/$n/credentials/request/$n-req-1" 2>/dev/null | jq -r '.status // empty' || true)
    [[ -z $st ]] && st=ISSUED   # already held from an earlier run
    [[ $st == ISSUED ]] && break
    [[ $st == ERROR || $st == REJECTED ]] && { echo "$n credential request $st" >&2; exit 1; }
    sleep 2
  done
  [[ $st == ISSUED ]] || { echo "$n credentials not issued ($st)" >&2; exit 1; }
  echo "  $n: $(curl -fsS -H "x-api-key: $IH_SUPERUSER_KEY" "$IH/participants/$n/credentials" | jq -c '[.[].verifiableCredential.credential.type[-1]] | sort')"
done
log "identity layer ready: ${#IDS[@]} DIDs with verifiable credentials"
