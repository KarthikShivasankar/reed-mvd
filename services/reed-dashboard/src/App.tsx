import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { AppConfig } from "./config";
import { Api, AuditEvent, Classification, flattenDatasets, offerIdFor, prop, val } from "./api";
import {
  DiscoverabilityChip,
  Json,
  Led,
  Panel,
  SectionHead,
  SensitivityChip,
  TemplateChip,
} from "./ui";

type View = "overview" | "matrix" | "catalogue" | "negotiate" | "policies" | "edc" | "transfers" | "audit";

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "matrix", label: "Matrix" },
  { id: "catalogue", label: "Catalogue" },
  { id: "negotiate", label: "Negotiate" },
  { id: "policies", label: "Policies" },
  { id: "edc", label: "EDC Catalog" },
  { id: "transfers", label: "Transfers" },
  { id: "audit", label: "Audit" },
];

/* generic fetch hook */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}

const reveal = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

export function App({ config }: { config: AppConfig }) {
  const api = useMemo(() => new Api(config), [config]);
  const [view, setView] = useState<View>("overview");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">REED</span>
          <span className="sub">Manufacturing Data Space · Control Surface</span>
        </div>
        <nav className="nav">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        <motion.div key={view} {...reveal}>
          {view === "overview" && <Overview api={api} config={config} onJump={setView} />}
          {view === "matrix" && <Matrix api={api} />}
          {view === "catalogue" && <Catalogue api={api} config={config} />}
          {view === "negotiate" && <Negotiate api={api} config={config} />}
          {view === "policies" && <Policies api={api} />}
          {view === "edc" && <EdcCatalog api={api} />}
          {view === "transfers" && <Transfers api={api} config={config} />}
          {view === "audit" && <Audit api={api} />}
        </motion.div>
      </main>

      <footer className="footer">
        <span>REED · EDC 0.17.0</span>
        <span>backend {config.reedBackendUrl}</span>
        <span>metadata-first · contract-gated · audited</span>
      </footer>
    </div>
  );
}

/* ------------------------------- Overview ------------------------------ */
function Overview({ api, config, onJump }: { api: Api; config: AppConfig; onJump: (v: View) => void }) {
  const cls = useAsync(() => api.classifications(), []);
  const tpl = useAsync(() => api.policyTemplates(), []);
  const audit = useAsync(() => api.audit(), []);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(config.reedBackendUrl + "/reed/classifications")
      .then((r) => setBackendUp(r.ok))
      .catch(() => setBackendUp(false));
  }, [config.reedBackendUrl]);

  const pulls = audit.data?.filter((a) => a.eventType === "PULL").length ?? 0;

  return (
    <>
      <SectionHead
        idx="00 /"
        title="Overview"
        desc="A partner discovers that data exists without receiving the confidential payload — until a contract is accepted, and every access is audited."
      />
      <div className="stat-grid">
        <Stat label="Asset classes" value={cls.data?.length ?? "—"} />
        <Stat label="Policy templates" value={tpl.data?.length ?? "—"} tone="cyan" />
        <Stat label="Audit events" value={audit.data?.length ?? "—"} tone="violet" />
        <Stat label="Payload pulls" value={pulls} unit="EDR-gated" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Panel title="Sovereign sharing flow">
          <div className="flowbar">
            <span className="step done">classify</span>
            <span className="arrow">→</span>
            <span className="step done">publish metadata</span>
            <span className="arrow">→</span>
            <span className="step active">discover</span>
            <span className="arrow">→</span>
            <span className="step">negotiate</span>
            <span className="arrow">→</span>
            <span className="step">EDR</span>
            <span className="arrow">→</span>
            <span className="step">pull payload</span>
          </div>
          <p className="muted" style={{ marginTop: 14, fontSize: 12.5 }}>
            Only metadata reaches the EDC catalogue. The confidential payload stays in the
            REED submodel service and is reachable only through an EDR issued after a
            contract reaches <span className="mono" style={{ color: "var(--cyan)" }}>FINALIZED</span>.
          </p>
        </Panel>

        <Panel title="System status">
          <div style={{ display: "grid", gap: 12 }}>
            <Led online={backendUp} label={`REED backend · ${config.reedBackendUrl}`} />
            {config.connectors.map((c) => (
              <div key={c.name} className="mono faint" style={{ fontSize: 11.5 }}>
                ◆ {c.name} · {c.managementUrl}
              </div>
            ))}
            <div className="mono faint" style={{ fontSize: 11.5 }}>
              ◆ federated-catalog · {config.federatedCatalogUrl}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn ghost" onClick={() => onJump("catalogue")}>
              Open catalogue →
            </button>
            <button className="btn ghost" onClick={() => onJump("audit")}>
              View audit →
            </button>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value, unit, tone }: { label: string; value: number | string; unit?: string; tone?: "cyan" | "violet" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="bar" />
    </div>
  );
}

/* -------------------------------- Matrix ------------------------------- */
function Matrix({ api }: { api: Api }) {
  const { data, error, loading } = useAsync(() => api.classifications(), []);
  return (
    <>
      <SectionHead idx="01 /" title="Classification Matrix" desc="Eight asset classes, each with a sensitivity, a discoverability scope, and a default policy template." />
      <Panel title="reed_asset_classification">
        {loading && <div className="empty">loading…</div>}
        {error && <div className="error">backend unreachable — {error}</div>}
        {data && (
          <table className="grid">
            <thead>
              <tr>
                <th>Asset class</th>
                <th>Sample id</th>
                <th>Sensitivity</th>
                <th>Discoverability</th>
                <th>Policy template</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c: Classification) => (
                <tr key={c.assetClass}>
                  <td className="asset-name">{c.assetClass}</td>
                  <td className="asset-id">{kebab(c.assetClass)}-001</td>
                  <td><SensitivityChip value={c.sensitivity} /></td>
                  <td><DiscoverabilityChip value={c.discoverability} /></td>
                  <td><TemplateChip value={c.defaultPolicyTemplate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/* ------------------------------ Catalogue ------------------------------ */
function Catalogue({ api, config }: { api: Api; config: AppConfig }) {
  const [bpn, setBpn] = useState(config.bpns[0]?.bpn ?? "");
  const [custom, setCustom] = useState("");
  const active = custom.trim() || bpn;
  const { data, error, loading } = useAsync(() => api.catalogue(active), [active]);

  return (
    <>
      <SectionHead idx="02 /" title="Catalogue · Discoverability" desc="The catalogue layer: what a given partner BPN is allowed to see. Bilateral/project assets stay hidden without a supply-chain relation." />
      <div className="controls">
        <div className="seg">
          {config.bpns.map((b) => (
            <button key={b.bpn} className={!custom && bpn === b.bpn ? "active" : ""} onClick={() => { setCustom(""); setBpn(b.bpn); }} title={b.bpn}>
              {b.label}
            </button>
          ))}
        </div>
        <input className="field" placeholder="custom BPN…" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ width: 200 }} />
        <span className="mono faint" style={{ fontSize: 11 }}>resolving · {active}</span>
      </div>

      <Panel title={`visible to ${active}`} right={<span className="mono faint">{data?.length ?? 0} asset(s)</span>}>
        {loading && <div className="empty">querying catalogue…</div>}
        {error && <div className="error">backend unreachable — {error}</div>}
        {data && data.length === 0 && <div className="empty">no assets discoverable for this BPN</div>}
        {data && data.length > 0 && (
          <table className="grid">
            <thead>
              <tr><th>Asset</th><th>Sensitivity</th><th>Discoverability</th><th>Template</th><th>Owner</th></tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.assetId}>
                  <td>
                    <div className="asset-name">{a.title}</div>
                    <div className="asset-id">{a.assetId}</div>
                  </td>
                  <td><SensitivityChip value={a.sensitivity} /></td>
                  <td><DiscoverabilityChip value={a.discoverability} /></td>
                  <td><TemplateChip value={a.policyTemplate} /></td>
                  <td className="mono faint">{a.ownerBpn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/* ------------------------------- Policies ------------------------------ */
function Policies({ api }: { api: Api }) {
  const { data, error, loading } = useAsync(() => api.policyTemplates(), []);
  return (
    <>
      <SectionHead idx="03 /" title="Policy Templates" desc="The faithful ODRL REED renders per asset. Under iam-mock the connector policy is permissive; these constraints are what DCP/IdentityHub would enforce." />
      {loading && <div className="empty">loading…</div>}
      {error && <div className="error">backend unreachable — {error}</div>}
      {data && (
        <div className="cards">
          {data.map((t) => {
            let odrl: unknown = t.odrl;
            try { odrl = JSON.parse(t.odrl); } catch { /* keep raw */ }
            return (
              <div className="tmpl-card" key={t.name}>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <Json value={odrl} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------ EDC Catalog ---------------------------- */
function EdcCatalog({ api }: { api: Api }) {
  const { data, error, loading, reload } = useAsync(() => api.federatedCatalog(), []);
  const datasets = data ? flattenDatasets(data) : [];
  return (
    <>
      <SectionHead idx="04 /" title="EDC · Federated Catalog" desc="Live datasets aggregated by the federated catalog crawler. This is the EDC view — metadata only, no payload." />
      <Panel title="POST /management/v3/catalogs/request" right={<button className="btn ghost" onClick={reload}>refresh</button>}>
        {loading && <div className="empty">crawling…</div>}
        {error && <div className="error">federated catalog unreachable — {error}</div>}
        {data && datasets.length === 0 && <div className="empty">no datasets yet — run ./seed-reed.sh, then wait for a crawl cycle (~15s)</div>}
        {datasets.length > 0 && (
          <table className="grid">
            <thead><tr><th>Dataset @id</th><th>Asset class</th><th>Sensitivity</th><th>Discoverability</th></tr></thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d["@id"]}>
                  <td className="asset-id" style={{ fontSize: 12 }}>{d["@id"]}</td>
                  <td className="asset-name">{prop(d, "assetClass") ?? "—"}</td>
                  <td>{prop(d, "sensitivity") ? <SensitivityChip value={String(prop(d, "sensitivity"))} /> : "—"}</td>
                  <td>{prop(d, "discoverability") ? <DiscoverabilityChip value={String(prop(d, "discoverability"))} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/* ------------------------------ Transfers ------------------------------ */
function Transfers({ api, config }: { api: Api; config: AppConfig }) {
  const consumer = config.connectors.find((c) => c.name.includes("consumer")) ?? config.connectors[0];
  const url = consumer.managementUrl;
  const negs = useAsync(() => api.list(url, "contractnegotiations"), [url]);
  const tps = useAsync(() => api.list(url, "transferprocesses"), [url]);

  return (
    <>
      <SectionHead idx="05 /" title="Contracts & Transfers" desc={`Negotiations and transfer processes recorded by ${consumer.name}.`} />
      <div style={{ display: "grid", gap: 14 }}>
        <Panel title="contract negotiations" right={<button className="btn ghost" onClick={negs.reload}>refresh</button>}>
          <StateList rows={negs.data} error={negs.error} loading={negs.loading} idKey="@id" />
        </Panel>
        <Panel title="transfer processes" right={<button className="btn ghost" onClick={tps.reload}>refresh</button>}>
          <StateList rows={tps.data} error={tps.error} loading={tps.loading} idKey="@id" />
        </Panel>
      </div>
    </>
  );
}

function StateList({ rows, error, loading, idKey }: { rows: any[] | null; error: string | null; loading: boolean; idKey: string }) {
  if (loading) return <div className="empty">loading…</div>;
  if (error) return <div className="error">connector unreachable — {error}</div>;
  if (!rows || rows.length === 0) return <div className="empty">none yet — run ./run-transfer.sh</div>;
  return (
    <table className="grid">
      <thead><tr><th>@id</th><th>State</th><th>Counterparty</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r[idKey] ?? i}>
            <td className="asset-id" style={{ fontSize: 12 }}>{r["@id"] ?? r.id}</td>
            <td><span className="chip" style={{ "--c": stateColor(r.state) } as any}><span className="dot" />{r.state ?? "—"}</span></td>
            <td className="mono faint">{r.counterPartyId ?? r.counterPartyAddress ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function stateColor(state?: string): string {
  if (!state) return "var(--text-faint)";
  if (state.includes("FINALIZED") || state.includes("STARTED") || state.includes("COMPLETED")) return "var(--cyan)";
  if (state.includes("TERMINAT") || state.includes("ERROR")) return "var(--red)";
  return "var(--amber)";
}

/* -------------------------------- Audit -------------------------------- */
function Audit({ api }: { api: Api }) {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const timer = useRef<number | null>(null);

  const poll = useCallback(() => {
    api.audit().then((d) => { setRows(d); setError(null); }).catch((e) => setError(String(e.message ?? e)));
  }, [api]);

  useEffect(() => {
    poll();
    if (live) {
      timer.current = window.setInterval(poll, 3000);
      return () => { if (timer.current) window.clearInterval(timer.current); };
    }
  }, [live, poll]);

  return (
    <>
      <SectionHead idx="06 /" title="Audit Log" desc="Append-only record of every classify, discover, request, negotiate and pull — the backbone of accountable access." />
      <Panel
        title="reed_audit_event"
        right={
          <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
            <Led online={live ? true : null} label={live ? "LIVE · 3s" : "paused"} />
            <button className="btn ghost" onClick={() => setLive((l) => !l)}>{live ? "pause" : "resume"}</button>
          </span>
        }
      >
        {error && <div className="error">backend unreachable — {error}</div>}
        {rows && rows.length === 0 && <div className="empty">no events yet</div>}
        {rows && rows.length > 0 && (
          <div style={{ display: "grid", gap: 1 }}>
            <div className="audit-row" style={{ padding: "6px 4px", color: "var(--text-faint)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" }}>
              <span>Event</span><span>Actor BPN</span><span>Detail</span><span className="right">Timestamp</span>
            </div>
            {rows.map((e) => (
              <div className="audit-row" key={e.id} style={{ padding: "9px 4px", borderTop: "1px solid rgba(34,43,51,0.6)" }}>
                <span className={`evt evt-${e.eventType}`}>{e.eventType}</span>
                <span className="mono faint" style={{ fontSize: 11 }}>{e.actorBpn ?? "—"}</span>
                <span style={{ fontSize: 12.5 }}>
                  {e.detail}
                  {e.assetId && <span className="asset-id"> · {e.assetId}</span>}
                </span>
                <span className="right mono faint" style={{ fontSize: 11 }}>{new Date(e.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

/* ------------------------------ Negotiate ------------------------------ */
const FLOW = ["fetch offer", "negotiate", "FINALIZED", "transfer", "STARTED", "EDR", "pull payload"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Negotiate({ api, config }: { api: Api; config: AppConfig }) {
  const cat = useAsync(() => api.providerCatalog(), []);
  const datasets = cat.data ? flattenDatasets(cat.data) : [];
  const [running, setRunning] = useState<string | null>(null);
  const [stage, setStage] = useState(-1);
  const [log, setLog] = useState<string[]>([]);
  const [payload, setPayload] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const add = (m: string) => setLog((l) => [...l, m]);

  async function run(assetId: string) {
    setRunning(assetId); setStage(0); setLog([]); setPayload(null); setErr(null);
    try {
      const offerId = offerIdFor(cat.data, assetId);
      if (!offerId) throw new Error(`no contract offer found for ${assetId}`);
      add(`◆ offer ${offerId.slice(0, 28)}…`);

      setStage(1);
      const neg = await api.negotiate(offerId, assetId);
      const negId = neg["@id"] ?? neg.id;
      add(`◆ negotiation ${negId}`);
      let agreementId = "";
      for (let i = 0; i < 60; i++) {
        const n = await api.getNegotiation(negId);
        const st = val(n.state) ?? val(n["edc:state"]);
        if (st === "FINALIZED") { agreementId = val(n.contractAgreementId) ?? val(n["edc:contractAgreementId"]) ?? ""; break; }
        await sleep(1500);
      }
      if (!agreementId) throw new Error("negotiation did not reach FINALIZED");
      setStage(2); add(`◆ agreement ${agreementId}`);

      setStage(3);
      const tp = await api.transfer(agreementId, assetId);
      const tpId = tp["@id"] ?? tp.id;
      add(`◆ transfer ${tpId}`);
      for (let i = 0; i < 60; i++) {
        const t = await api.getTransfer(tpId);
        if ((val(t.state) ?? val(t["edc:state"])) === "STARTED") break;
        await sleep(1500);
      }
      setStage(4);

      let edr: any = null;
      for (let i = 0; i < 30; i++) { try { edr = await api.getEdr(tpId); if (edr) break; } catch { /* not ready */ } await sleep(1500); }
      const endpoint = val(edr?.endpoint) ?? val(edr?.["edc:endpoint"]);
      const auth = val(edr?.authorization) ?? val(edr?.["edc:authorization"]);
      if (!endpoint || !auth) throw new Error("EDR not issued in time");
      setStage(5); add(`◆ EDR endpoint ${endpoint}`);

      const data = await api.pull(endpoint, auth);
      setStage(6); setPayload(data); add("◆ confidential payload received ✓");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <SectionHead idx="03 /" title="Negotiate · Consumer Pull" desc={`Run the full contract flow from ${config.consumerManagementUrl.includes("29193") ? "consumer-1" : "the consumer"} against ${config.provider.id}: negotiate → FINALIZED → transfer → EDR → pull.`} />

      <div className="flowbar" style={{ marginBottom: 16 }}>
        {FLOW.map((s, i) => (
          <span key={s} style={{ display: "contents" }}>
            <span className={`step ${stage > i ? "done" : stage === i ? "active" : ""}`}>{s}</span>
            {i < FLOW.length - 1 && <span className="arrow">→</span>}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Panel title={`offers from ${config.provider.id}`} right={<button className="btn ghost" onClick={cat.reload}>refresh</button>}>
          {cat.loading && <div className="empty">fetching catalog…</div>}
          {cat.error && <div className="error">catalog unreachable — {cat.error}</div>}
          {datasets.length === 0 && !cat.loading && <div className="empty">no offers — run ./seed-reed.sh first</div>}
          {datasets.length > 0 && (
            <table className="grid">
              <thead><tr><th>Asset</th><th>Class</th><th /></tr></thead>
              <tbody>
                {datasets.map((d) => {
                  const id = d["@id"] ?? d.id;
                  return (
                    <tr key={id}>
                      <td className="asset-id" style={{ fontSize: 12 }}>{id}</td>
                      <td className="asset-name">{prop(d, "assetClass") ?? "—"}</td>
                      <td className="right">
                        <button className="btn" disabled={!!running} onClick={() => run(id)}>
                          {running === id ? "running…" : "negotiate & pull"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="workflow trace">
          {err && <div className="error" style={{ marginBottom: 10 }}>✕ {err}</div>}
          {log.length === 0 && !err && <div className="empty">pick an asset and click “negotiate &amp; pull”.</div>}
          {log.length > 0 && (
            <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.9, color: "var(--text-dim)" }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {payload && (
            <>
              <div className="panel-head" style={{ margin: "12px -14px 8px", paddingLeft: 14 }}>confidential payload · post-contract</div>
              <Json value={safeParse(payload)} />
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

function kebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
