# REED dashboard

React 18 + Vite + TypeScript SPA, served by nginx on `:8088` (container port 8080).

- **Login**: `keycloak-js`, authorization code + PKCE against realm `reed`; tokens live in memory.
- **Backend only**: every call goes to the REED backend with the user's bearer token. EDC
  Management API calls are relayed by the backend (`/reed/connectors/{name}/**`) to the user's
  own organisation's connector; the browser never holds a connector key. EDR payload pulls go
  directly to the provider's public data plane.
- **Runtime config**: `/config.json` (generated `deployment/dashboard/config.json`, bind-mounted):
  backend URL, Keycloak, and the connectors (name, company, DID, DSP and public URLs).
- **Routing**: the view is in the URL hash (`#/matches/R1`), so views can be bookmarked and shared.
  Roles decide what the nav shows; membership and a connector decide what can be opened.

## Source layout

| File | |
|---|---|
| `src/main.tsx`, `src/auth.ts`, `src/config.ts` | boot: config → login → app |
| `src/App.tsx` | shell, routing, role-aware nav, organisation badge |
| `src/api.ts` | typed REED client and `runReedFlow()` (catalog → negotiate → transfer → EDR → pull) |
| `src/views/Overview.tsx` | organisation, open work, the 11 scenarios, topology |
| `src/views/DataSpace.tsx` | who gets my data (board + terms editor, preview, publish), what I can get (credentials, live contract + pull), cross-border stories, why a data space |
| `src/views/Factory.tsx` | shop floor: live sensors, history, attention, briefing, line controls (fault / maintenance), observations |
| `src/views/Marketplace.tsx` | RFQ list, RFQ form with local-LLM drafting |
| `src/views/Matches.tsx` | ranking (score bars), rejections, partners, explanation, contract-and-confirm flow |
| `src/views/Opportunities.tsx`, `src/views/Assistant.tsx` | supplier view, chat |
| `src/views/DataViews.tsx` | catalogue, contracts, EDC catalog, audit, members, policies, matrix |
| `src/diagram.tsx` | the topology diagram, driven live during a contract |
| `src/guide.tsx` | per-view explainers and the network reference |
| `src/ui.tsx`, `src/styles.css` | shared components (score bars, credential chips, toasts) and styles |
| `e2e/reed.spec.ts` | Playwright end-to-end tests |

## Develop and test

```bash
npm ci
npx tsc --noEmit
docker compose -f ../../deployment/docker-compose.yml up --build -d dashboard   # rebuild the image
npx playwright install chromium     # once
npx playwright test                 # needs the stack up and seeded; REED_UI overrides the URL
```
