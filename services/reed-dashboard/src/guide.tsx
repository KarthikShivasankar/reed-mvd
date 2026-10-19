/* =========================================================================
   In-UI explanations. Each view renders an <Explainer> describing its ROLE,
   WHAT it contains, and HOW it is used in the sovereign-sharing process. This
   mirrors services/reed-dashboard/README.md so the UI is self-documenting.
   ========================================================================= */

export interface TabHelp {
  role: string;
  contains: string[];
  usage: string;
  /** Workflow step number (1-4) for the operational tabs. */
  step?: number;
  /** Which REED policy layer this tab maps onto, if any. */
  layer?: string;
}

export const TAB_HELP: Record<string, TabHelp> = {
  overview: {
    role: "Your organisation's starting point in the REED data space: who you are, what is waiting for you, and how a sovereign exchange works.",
    contains: [
      "Your organisation, role and the certifications the REED issuer has verified for it.",
      "What needs your attention: open RFQs, matches to answer, opportunities.",
      "The real-case scenarios across wind, offshore, rail / heavy machinery (including illustrative Komatsu mining-shovel parts) and hydropower.",
      "The topology diagram: six connectors, the identity services, the federated catalog and the REED backend.",
    ],
    usage: "Start here. Open a scenario to see its ranked suppliers, or press ▶ on the diagram to walk the six stages of an exchange.",
  },
  marketplace: {
    role: "The demand side: requests for quotation (RFQs) posted by OEMs for large industrial parts.",
    contains: [
      "Open and awarded RFQs from every member, with part size, mass, material and required certifications.",
      "A form to post a new RFQ - buyers only - and an assistant that drafts it from plain text using a local model.",
    ],
    usage: "Buyers describe a part and post the RFQ; REED ranks suppliers immediately. Everyone else can browse what is in demand.",
  },
  matches: {
    role: "Explainable matchmaking: which suppliers can make this part, why they rank where they do, and who was filtered out.",
    contains: [
      "Hard requirements (process, material, part size in any orientation, mass, tolerance, lead time, verified certifications) with the reason each supplier failed.",
      "A weighted score for each qualified supplier: lead time, tolerance margin, logistics for bulky parts, track record, sector experience and embedded CO2.",
      "Partner recommendations for steps the main supplier does not cover (NDT, heavy-lift, finish machining).",
      "The match lifecycle: shortlist, the supplier accepts, an EDC contract for the supplier's confidential capability, then confirmation.",
    ],
    usage: "Shortlist the top supplier. Once it accepts, request its confidential process capability over EDC; REED checks the contract and the real figures before confirming the match.",
    layer: "contract layer",
  },
  opportunities: {
    role: "The supply side: RFQs your organisation qualifies for, and matches waiting for your answer.",
    contains: [
      "Open RFQs where you pass every hard requirement, with your own score - never your competitors'.",
      "Shortlists from buyers that you can accept or decline.",
    ],
    usage: "Accepting a shortlist tells the buyer you want to quote; the buyer can then contract for your confidential capability.",
  },
  assistant: {
    role: "A question-answering helper for matchmaking, running on a local model (Qwen3.8 via LiteLLM) inside the deployment.",
    contains: [
      "Chat that looks up RFQs, rankings and supplier profiles through read-only tools, as your organisation.",
      "Scores and reasons always come from the REED scorer; the model only explains them.",
    ],
    usage: "Ask things like 'who can cast a 38 t hub with DNV approval?' or 'why was Śląsk rejected for R1?'. Personal data in your messages is removed before the model sees them.",
  },
  participants: {
    role: "The member directory: every company in the data space, where it is, what it claims it can do, and what has been verified.",
    contains: [
      "Location, quay and rail access, sectors and role.",
      "Verified certifications (issued as credentials) next to self-declared ones that do not count.",
      "Each connector-running member's decentralized identifier (DID).",
    ],
    usage: "Use it to understand a match or rejection, or to see which members can already exchange data over EDC.",
  },
  matrix: {
    role: "The governance rulebook for the data itself: how every asset class is classified before it can be shared.",
    contains: [
      "The 8 REED asset classes and each one's sensitivity and discoverability.",
      "The default policy template per class.",
    ],
    usage: "Reference for why an asset is or is not shareable with a given partner.",
  },
  policies: {
    role: "The terms a consumer agrees to: the ODRL policy per template.",
    contains: [
      "Permission constraints on verifiable credentials, e.g. MembershipCredential.role = OEM - enforced by every connector.",
      "Prohibitions and obligations (no redistribution, audit, delete after expiry) - the usage layer REED records.",
    ],
    usage: "Read before negotiating to know which credentials a contract will ask for.",
    layer: "usage layer",
  },
  edc: {
    role: "The EDC view of discovery: what the federated catalog crawled from every member's connector.",
    contains: [
      "Datasets per member - metadata only, no payload.",
      "Only offers whose access policy the catalog operator's credentials satisfy (no bilateral assets).",
    ],
    usage: "Confirm what is published network-wide. New assets appear within one crawl cycle (about 15 seconds).",
  },
  catalogue: {
    role: "Discoverability for your organisation: what you are allowed to find across all members.",
    contains: [
      "Assets visible to your organisation through the supply-chain graph, from every owner.",
      "Sensitivity, discoverability, policy template and owner of each.",
    ],
    usage: "Operators can switch to another member's point of view to show why bilateral or project assets stay hidden. Each query is audited.",
    step: 1,
    layer: "catalogue layer",
  },
  transfers: {
    role: "Your connector's record of agreements and data flows.",
    contains: [
      "Contract negotiations with their states (FINALIZED, TERMINATED with the policy reason).",
      "Transfer processes with their states (STARTED).",
    ],
    usage: "Check that a contract finalised and the transfer started, or read why a provider refused it.",
    step: 2,
  },
  audit: {
    role: "The accountability record: proof that every access was governed and logged.",
    contains: [
      "Discovery, RFQ and match steps, assistant use, and every confidential payload pull.",
      "Members see their own organisation's events; operators see everything.",
    ],
    usage: "After a confirmed match you should see the RFQ, shortlist, acceptance, the PULL of the capability and the confirmation.",
    step: 3,
    layer: "usage layer",
  },
};

/* ---- connectors, endpoints & protocols reference ----------------------- */
export const PORT_ROLES: { suffix: string; path: string; ctx: string; caller: string; proto: string }[] = [
  { suffix: "x193", path: "/management", ctx: "Management API (key-protected)", caller: "REED backend relay · seed/run scripts", proto: "REST + JSON-LD" },
  { suffix: "x194", path: "/protocol", ctx: "DSP (Dataspace Protocol)", caller: "other connectors · FC crawler", proto: "DSP + VCs" },
  { suffix: "x291", path: "/public", ctx: "Data Plane Public (http-pull-proxy)", caller: "consumer pulling payload", proto: "HTTP + EDR JWT" },
  { suffix: "x191/2/5", path: "/api /control /version", ctx: "Default, signaling, version", caller: "internal", proto: "HTTP" },
];

export const COMM_MATRIX: { from: string; to: string; endpoint: string; proto: string; use: string }[] = [
  { from: "browser", to: "keycloak", endpoint: "8180 /realms/reed", proto: "OIDC", use: "log in (authorization code + PKCE)" },
  { from: "browser", to: "reed-backend", endpoint: "8081 /reed/*", proto: "REST + JWT", use: "matchmaking, directory, catalogue, audit, assistant" },
  { from: "reed-backend", to: "own connector", endpoint: "x193 /management", proto: "Management", use: "relay: catalog, negotiate, transfer, EDR (key server-side)" },
  { from: "connector", to: "connector", endpoint: "x194 /protocol/2025-1", proto: "DSP", use: "catalog, negotiation, transfer - with verifiable presentations" },
  { from: "connector", to: "its own <name>-ih", endpoint: "7084 /api/sts · 7082", proto: "DCP", use: "self-issued token, present credentials" },
  { from: "connector", to: "counterparty's <name>-ih", endpoint: "7083 /<name>/did.json", proto: "did:web", use: "resolve the counterparty's DID" },
  { from: "<name>-ih", to: "issuerservice", endpoint: "10012 /api/issuance", proto: "DCP", use: "request credentials (membership, certification, relation)" },
  { from: "every runtime", to: "vault", endpoint: "8200 secret/<name>/", proto: "Vault", use: "keys and secrets, each company confined to its own folder" },
  { from: "issuerservice", to: "postgres reed", endpoint: "vc_* views", proto: "JDBC", use: "attestations from the REED registry" },
  { from: "federated-catalog", to: "all connectors", endpoint: "x194 /protocol/2025-1", proto: "DSP", use: "crawl every 15 s with its own credentials" },
  { from: "browser", to: "provider data plane", endpoint: "x291 /public", proto: "HTTP+JWT", use: "pull the confidential payload with the EDR" },
  { from: "provider data plane", to: "reed-backend", endpoint: "8080 /reed/submodels", proto: "HTTP+key", use: "fetch the payload with the owner's own key" },
  { from: "reed-backend", to: "litellm", endpoint: "4000 /v1", proto: "OpenAI API", use: "assistant → Qwen3.8 on Ollama / vLLM (local)" },
];

const PROTO_LEGEND: { name: string; desc: string }[] = [
  { name: "DSP", desc: "Dataspace Protocol - JSON-LD between connectors (catalog, negotiation, transfer)." },
  { name: "DCP", desc: "Decentralized Claims Protocol - connectors prove membership, certifications and supply relations with verifiable credentials." },
  { name: "Management", desc: "REST API to drive your own connector. Key-protected; the dashboard reaches it only through the REED backend." },
  { name: "Public DP", desc: "The payload door - present the EDR JWT; the provider data plane verifies it and proxies to the backend." },
  { name: "OIDC", desc: "Human login via Keycloak; the token carries the user's roles and organisation (BPN)." },
];

export function NetworkReference() {
  return (
    <details className="netref">
      <summary>
        <span className="ex-icon">◆</span>
        Connectors, endpoints & protocols
        <span className="ex-caret">▾</span>
      </summary>
      <div className="netref-body">
        <div className="netref-grid">
          <div>
            <h4>Port convention <span className="faint">(19 Nordvind · 29 Castellum · 41 Hanse · 42 Wisła · 43 Maasvlakte · 44 Rhein NDT · 45 Komatsu · 39 FC)</span></h4>
            <table className="grid mini">
              <thead><tr><th>Port</th><th>Path</th><th>Context</th><th>Called by</th><th>Protocol</th></tr></thead>
              <tbody>
                {PORT_ROLES.map((r) => (
                  <tr key={r.suffix}>
                    <td className="mono" style={{ color: "var(--cyan)" }}>{r.suffix}</td>
                    <td className="mono faint">{r.path}</td>
                    <td>{r.ctx}</td>
                    <td className="faint">{r.caller}</td>
                    <td className="mono faint">{r.proto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4>Who talks to whom</h4>
            <table className="grid mini">
              <thead><tr><th>From → To</th><th>Endpoint</th><th>Proto</th><th>Use case</th></tr></thead>
              <tbody>
                {COMM_MATRIX.map((c, i) => (
                  <tr key={i}>
                    <td><span className="mono">{c.from}</span> <span className="faint">→</span> <span className="mono" style={{ color: "var(--amber)" }}>{c.to}</span></td>
                    <td className="mono faint">{c.endpoint}</td>
                    <td><span className={`proto-tag p-${c.proto.replace(/[^a-z]/gi, "")}`}>{c.proto}</span></td>
                    <td className="faint">{c.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="netref-legend">
          {PROTO_LEGEND.map((p) => (
            <div key={p.name} className="netref-leg"><b>{p.name}</b> — {p.desc}</div>
          ))}
        </div>
        <p className="muted netref-note">
          <b>URL rule:</b> connector↔connector and provider-DP→backend use Docker <b>service names</b>
          (<span className="mono">castellum:29194</span>); browser/script calls use <span className="mono">localhost</span>.
          Full reference: <span className="mono">docs/connectors-and-protocols.md</span>.
        </p>
      </div>
    </details>
  );
}

export function Explainer({ help }: { help: TabHelp }) {
  return (
    <details className="explainer">
      <summary>
        <span className="ex-icon">ⓘ</span>
        What this view is for & how it's used
        {help.step && <span className="ex-step">workflow step {help.step}</span>}
        {help.layer && <span className="ex-layer">{help.layer}</span>}
        <span className="ex-caret">▾</span>
      </summary>
      <div className="explainer-body">
        <div className="ex-col">
          <h4>Role</h4>
          <p>{help.role}</p>
        </div>
        <div className="ex-col">
          <h4>What's here</h4>
          <ul>
            {help.contains.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
        <div className="ex-col">
          <h4>How it's used in the process</h4>
          <p>{help.usage}</p>
        </div>
      </div>
    </details>
  );
}
