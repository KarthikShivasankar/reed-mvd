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
    role: "The map and control room of the data space — the single picture of how a payload moves from the OEM to a partner without losing sovereignty.",
    contains: [
      "Live counts: asset classes, policy templates, audit events, EDR-gated pulls.",
      "An interactive topology diagram of both connectors (control plane + data plane), the federated catalog and the REED backend.",
      "REED use-case scenarios you can RUN end-to-end against the live connectors.",
      "A numbered guided path and a system-status panel.",
    ],
    usage: "Start here. Press ▶ to walk the six stages, then pick a use case and 'run this scenario live' to watch a real contract → EDR → pull (or a denial) light up the diagram.",
  },
  matrix: {
    role: "The governance rulebook for the data itself — how every asset class is classified before any sharing can happen (the 'classify' stage).",
    contains: [
      "The 8 REED asset classes (part digital twin, BoM, DPP, process capability, fixtures, production status, quality evidence, simulation result).",
      "Each class's sensitivity (consortium → confidential → restricted → regulated) and discoverability (consortium / bilateral / project).",
      "The default ODRL policy template applied to each class.",
    ],
    usage: "Reference. This matrix is the source of truth that the REED backend renders into the connector as offers + policies. Read it to understand why an asset is or isn't shareable to a given partner.",
  },
  policies: {
    role: "The terms a consumer agrees to — the faithful ODRL that encodes who may use an asset and under what conditions (the usage layer).",
    contains: [
      "The 6 policy templates: consortium-only, bilateral-supplier, dpp-read-only, oem-only, time-limited-pilot-access, simulation-service-only.",
      "Each template's permissions, prohibitions (e.g. no redistribution), obligations (e.g. audit) and constraints (e.g. pilot expiry).",
    ],
    usage: "Inspect before negotiating. Under iam-mock the connector's enforced policy is permissive; these are the constraints a production DCP/IdentityHub would enforce and that REED enforces itself via discoverability + audit.",
    layer: "usage layer",
  },
  edc: {
    role: "The live EDC view of discovery — exactly what a partner's connector crawls across the data space.",
    contains: [
      "Datasets aggregated by the federated catalog crawler from every participant — metadata only, no payload.",
      "Each dataset annotated with its REED asset class, sensitivity and discoverability.",
    ],
    usage: "Confirm what is published at the EDC level. If a freshly seeded asset is missing, wait one crawl cycle (~15s) and refresh. This is the network-wide catalog behind the 'discover' stage.",
  },
  catalogue: {
    role: "Discoverability by partner — proves the catalogue layer: a partner can only find what it is entitled to find.",
    contains: [
      "The assets visible to a chosen Business Partner Number (BPN), driven by the supply-chain graph.",
      "Each asset's sensitivity, discoverability, policy template and owner.",
    ],
    usage: "Switch between Supplier, Simulation service and Outsider to watch bilateral/project assets appear and disappear. Each query is itself audited as a DISCOVER event. This is workflow step 1.",
    step: 1,
    layer: "catalogue layer",
  },
  negotiate: {
    role: "Run the sovereign exchange — the interactive heart of the demo where a contract is negotiated and the confidential payload is pulled.",
    contains: [
      "The provider's live contract offers.",
      "The shared topology diagram, driven LIVE as the flow runs.",
      "A step-by-step trace and the retrieved confidential payload.",
    ],
    usage: "Pick an offer and click 'negotiate & pull'. Watch fetch offer → negotiate → FINALIZED → transfer → STARTED → EDR → pull payload. The payload is unreachable until the contract finalizes. This is workflow step 2.",
    step: 2,
    layer: "contract layer",
  },
  transfers: {
    role: "The connector's record of agreements and data flows — the EDC state behind the contract and transfer stages.",
    contains: [
      "Contract negotiations with their DSP states (e.g. FINALIZED).",
      "Transfer processes with their states (e.g. STARTED).",
    ],
    usage: "After negotiating, confirm here that the negotiation reached FINALIZED and the transfer reached STARTED on the consumer connector. This is workflow step 3.",
    step: 3,
  },
  audit: {
    role: "The accountability record — the append-only proof that every access was governed and logged.",
    contains: [
      "Every CLASSIFY, DISCOVER, NEGOTIATE and PULL event, newest first.",
      "Actor BPN, asset id, detail and timestamp; auto-refreshing every 3s.",
    ],
    usage: "Verify the trail after running a scenario: a DISCOVER for the catalogue query and a PULL for the payload. This closes the loop — sovereignty plus traceability. This is workflow step 4.",
    step: 4,
    layer: "usage layer",
  },
};

/* ---- connectors, endpoints & protocols reference ----------------------- */
export const PORT_ROLES: { suffix: string; path: string; ctx: string; caller: string; proto: string }[] = [
  { suffix: "x191", path: "/api", ctx: "Default API", caller: "health / misc", proto: "HTTP" },
  { suffix: "x192", path: "/control", ctx: "Data Plane Signaling", caller: "control plane (internal)", proto: "REST" },
  { suffix: "x193", path: "/management", ctx: "Management API", caller: "dashboard · seed/run scripts", proto: "REST + JSON-LD" },
  { suffix: "x194", path: "/protocol", ctx: "DSP (Dataspace Protocol)", caller: "other connectors · FC crawler", proto: "DSP / JSON-LD" },
  { suffix: "x195", path: "/version", ctx: "Version API", caller: "tooling", proto: "HTTP" },
  { suffix: "x291", path: "/public", ctx: "Data Plane Public (http-pull-proxy)", caller: "consumer pulling payload", proto: "HTTP + EDR JWT" },
];

export const COMM_MATRIX: { from: string; to: string; endpoint: string; proto: string; use: string }[] = [
  { from: "browser", to: "consumer-1", endpoint: "29193 /management", proto: "Management", use: "drive the flow: catalog · negotiate · transfer · EDR" },
  { from: "seed-reed.sh", to: "reed-provider", endpoint: "19193 /management", proto: "Management", use: "publish the 8 asset classes as offers" },
  { from: "browser", to: "federated-catalog", endpoint: "39193 /management", proto: "Management", use: "catalogs/request — the EDC Catalog tab" },
  { from: "browser", to: "reed-backend", endpoint: "8081 /reed/*", proto: "REST", use: "Overview · Matrix · Catalogue · Policies · Audit" },
  { from: "consumer-1", to: "reed-provider", endpoint: "19194 /protocol/2025-1", proto: "DSP", use: "catalog request · negotiation · transfer start" },
  { from: "reed-provider", to: "consumer-1", endpoint: "29194 /protocol/2025-1", proto: "DSP", use: "async DSP callbacks (state messages)" },
  { from: "federated-catalog", to: "both connectors", endpoint: "x194 /protocol/2025-1", proto: "DSP", use: "periodic catalog crawl (~15s)" },
  { from: "consumer side", to: "reed-provider DP", endpoint: "19291 /public", proto: "HTTP+JWT", use: "pull the confidential payload (EDR)" },
  { from: "reed-provider DP", to: "reed-backend", endpoint: "reed-backend:8080 /reed/submodels", proto: "HTTP+X-Api-Key", use: "fetch the submodel the proxy streams back" },
  { from: "control plane", to: "data plane", endpoint: "x192 /control", proto: "Signaling", use: "START/SUSPEND/TERMINATE · mint EDR" },
  { from: "each connector", to: "vault", endpoint: "8200", proto: "Vault HTTP", use: "load EDR signing/verification keys (ES256)" },
  { from: "reed-backend", to: "postgres", endpoint: "5432", proto: "JDBC", use: "persist the 5 REED tables" },
];

const PROTO_LEGEND: { name: string; desc: string }[] = [
  { name: "DSP", desc: "Dataspace Protocol — async JSON-LD between connectors (catalog, negotiation, transfer). Connectors never expose it to apps." },
  { name: "Management", desc: "REST API to drive your OWN connector (publish, negotiate, read EDR). Never expose publicly." },
  { name: "Signaling", desc: "Control plane → data plane control channel (collocated here)." },
  { name: "Public DP", desc: "The payload door — present the EDR JWT, the provider data plane verifies & reverse-proxies to the backend." },
  { name: "iam-mock", desc: "Stands in for DCP/Identity Hub — always-allow, no verifiable BPN, so EDC policies stay permissive." },
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
            <h4>Port convention <span className="faint">(1x=provider · 2x=consumer · 3x=FC)</span></h4>
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
          (<span className="mono">reed-provider:19194</span>); browser/script calls use <span className="mono">localhost</span>.
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
