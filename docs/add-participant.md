# Adding a participant

Everything about a participant lives in **`deployment/roster.json`**; the generator writes the
rest. There is nothing to edit by hand in the compose file, connector configs, Keycloak realm or
dashboard config.

## 1. Add the company to the roster

```jsonc
{
  "bpn": "BPN-REED-SUP-0013",
  "name": "Baltic Forge Oy",            // fictional companies only, unless the company agreed
  "short": "Baltic Forge",
  "role": "SUPPLIER",                    // OEM | SUPPLIER | SERVICE
  "country": "FI", "city": "Turku", "vatId": "FI00000013",
  "lat": 60.45, "lon": 22.27, "portAccess": true, "railAccess": true,
  "sectors": ["offshore", "wind"],
  "connector": { "name": "baltic-forge", "portPrefix": "45" },   // omit for a directory-only member
  "attestations": ["ISO9001", "DNV"],    // certifications a trusted body attested -> CertificationCredential
  "relations": [{ "type": "SUPPLIES", "to": "BPN-REED-OEM-0002" }],
  "capability": { "summary": "...", "processes": ["open-die-forging"], "materials": ["42CrMo4"],
                  "envelopeMm": [12000, 2500, 2500], "maxMassKg": 60000, "bestTolMm": 0.1,
                  "leadTimeWeeks": 16, "capacity": "MEDIUM", "co2KgPerKg": 0.8,
                  "claimedCerts": ["ISO9001", "DNV"] },
  "confidentialCapability": { "machines": ["..."], "envelopeMm": [12000, 2500, 2500],
                              "maxMassKg": 60000, "bestTolMm": 0.1, "leadTimeWeeks": 16 },
  "assets": ["ProcessCapability", "QualityEvidence"],
  "users": [{ "username": "balticforge-engineer", "roles": ["supplier-engineer"] }]
}
```

Port prefixes are two digits giving ports `<p>191`-`<p>195` and `<p>291`; they must stay below
65535, so use 10-64 and avoid the ones in use (19, 29, 39, 41-44).

Without `connector` the company is still a member: it appears in the directory and in rankings,
can be shortlisted, but cannot confirm a match (that needs an EDC contract). Set
`"consortium": false` for a known non-member.

## 2. Regenerate and restart

```bash
python3 tools/gen_topology.py      # new connector config, compose service, realm users, keys, .env entry
docker compose -f deployment/docker-compose.yml down -v   # roster is seeded into an empty database
docker compose -f deployment/docker-compose.yml up --build -d
./seed-identity.sh                 # DID + credentials for the new connector
./seed-reed.sh                     # its assets, policies and CEL rules
```

The federated catalog picks up the new connector from its regenerated `participants.json`
within one crawl cycle (~15 s).

## 3. Check

- Members tab: the company shows its verified certifications and DID.
- `./run-matchmaking.sh` still passes (add a scenario to `deployment/scenarios/matchmaking.json`
  if the newcomer should win one) and `./gradlew :services:reed-backend:test` is green.
