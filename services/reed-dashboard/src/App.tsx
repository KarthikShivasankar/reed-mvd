import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { AppConfig } from "./config";
import { Api, AuditEvent, Classification, flattenDatasets, prop, runReedFlow } from "./api";
import {
  DiscoverabilityChip,
  Json,
  Led,
  Panel,
  SectionHead,
  SensitivityChip,
  TemplateChip,
} from "./ui";
import { GuidedPath, SCENARIOS, Scenario, StepId, Topology } from "./diagram";
import { Explainer, NetworkReference, TAB_HELP } from "./guide";

type View = "overview" | "matrix" | "catalogue" | "negotiate" | "policies" | "edc" | "transfers" | "audit";

type Group = "start" | "model" | "flow";
const VIEWS: { id: View; label: string; group: Group; step?: number }[] = [
  { id: "overview", label: "Overview", group: "start" },
  { id: "matrix", label: "Matrix", group: "model" },
  { id: "policies", label: "Policies", group: "model" },
  { id: "edc", label: "EDC Catalog", group: "model" },
  { id: "catalogue", label: "Catalogue", group: "flow", step: 1 },
  { id: "negotiate", label: "Negotiate", group: "flow", step: 2 },
  { id: "transfers", label: "Transfers", group: "flow", step: 3 },
  { id: "audit", label: "Audit", group: "flow", step: 4 },
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
          {VIEWS.map((v, i) => {
            const newGroup = i > 0 && VIEWS[i - 1].group !== v.group;
            return (
              <span key={v.id} style={{ display: "contents" }}>
                {newGroup && <span className="nav-sep" aria-hidden />}
                <button className={view === v.id ? "active" : ""} onClick={() => setView(v.id)} title={v.group === "flow" ? `Workflow step ${v.step}` : undefined}>
                  {v.step && <span className="nav-step">{v.step}</span>}
                  {v.label}
                </button>
              </span>
            );
          })}
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
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);

  /* live scenario runner — exercises the real REED + connector flow */
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(-1);
  const [slog, setSlog] = useState<string[]>([]);
  const [payload, setPayload] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [serr, setSerr] = useState<string | null>(null);

  /* custom scenario builder inputs */
  const assetIds = useMemo(() => (cls.data ?? []).map((c) => `${kebab(c.assetClass)}-001`), [cls.data]);
  const [cBpn, setCBpn] = useState(config.bpns[0]?.bpn ?? "");
  const [cBpnText, setCBpnText] = useState("");
  const [cAsset, setCAsset] = useState("");
  useEffect(() => { if (!cAsset && assetIds.length) setCAsset(assetIds[0]); }, [assetIds, cAsset]);

  const resetRun = useCallback(() => { setRunning(false); setStage(-1); setSlog([]); setPayload(null); setDenied(false); setSerr(null); }, []);
  const pick = (s: Scenario) => { resetRun(); setScenario(s); };
  const slogAdd = (m: string) => setSlog((l) => [...l, m]);

  async function runScenario(s: Scenario) {
    resetRun(); setScenario(s); setRunning(true); setStage(0);
    try {
      // 1. catalogue layer — does this BPN even see the asset? (real REED check)
      slogAdd(`◆ DISCOVER as ${s.consumerBpn}`);
      const visible = await api.catalogue(s.consumerBpn);
      const found = visible.find((a) => a.assetId === s.asset);
      if (!found) {
        slogAdd(`✕ ${s.asset} not discoverable — catalogue layer blocks ${s.consumerBpn}`);
        setDenied(true); setStage(0); setRunning(false);
        audit.reload();
        return;
      }
      slogAdd(`◆ discoverable · ${found.sensitivity} · ${found.policyTemplate}`);
      // 2..6 full contract → EDR → pull (real connector flow)
      const data = await runReedFlow(api, s.asset, { onStage: setStage, onLog: slogAdd });
      setPayload(data);
      audit.reload();
    } catch (e: any) {
      setSerr(String(e.message ?? e));
    } finally {
      setRunning(false);
    }
  }

  function runCustom() {
    const bpn = (cBpnText.trim() || cBpn).trim();
    if (!bpn || !cAsset) return;
    const meta = cls.data?.find((c) => `${kebab(c.assetClass)}-001` === cAsset);
    const label = config.bpns.find((b) => b.bpn === bpn)?.label ?? "Custom partner";
    runScenario({
      id: "custom",
      label: "Custom scenario",
      consumer: label,
      consumerBpn: bpn,
      asset: cAsset,
      sensitivity: meta?.sensitivity ?? "confidential",
      outcome: "granted",
      story: `Custom REED scenario: does ${label} (${bpn}) get ${cAsset}? The catalogue layer decides discoverability, then the contract + data plane decide the rest.`,
    });
  }

  const consumerLabel = `CONSUMER · ${scenario.consumer} · ${scenario.consumerBpn}`;

  return (
    <>
      <SectionHead
        idx="00 /"
        title="Overview"
        desc="A partner discovers that data exists without receiving the confidential payload — until a contract is accepted, and every access is audited."
      />
      <Explainer help={TAB_HELP.overview} />
      <div className="stat-grid">
        <Stat label="Asset classes" value={cls.data?.length ?? "—"} />
        <Stat label="Policy templates" value={tpl.data?.length ?? "—"} tone="cyan" />
        <Stat label="Audit events" value={audit.data?.length ?? "—"} tone="violet" />
        <Stat label="Payload pulls" value={pulls} unit="EDR-gated" />
      </div>

      <Panel title="Dataspace topology & sovereign sharing flow" right={<span className="mono faint" style={{ fontSize: 10.5 }}>control plane ⇄ data plane · supplier ⇄ OEM</span>}>
        <div className="scenario-bar">
          <span className="scenario-label">REED use case</span>
          <div className="seg">
            {SCENARIOS.map((s) => (
              <button key={s.id} className={scenario.id === s.id ? "active" : ""} onClick={() => pick(s)} title={s.label} disabled={running}>
                {s.label}
              </button>
            ))}
          </div>
          {scenario.id !== "custom" && (
            <span className={`scenario-outcome ${scenario.outcome}`}>{scenario.outcome === "granted" ? "expects: granted" : "expects: denied"}</span>
          )}
        </div>
        <div className="scenario-story">
          <b>{scenario.consumer}</b> wants <span className="mono">{scenario.asset}</span> (<SensitivityChip value={scenario.sensitivity} />). {scenario.story}
        </div>

        <div className="scenario-run">
          <button className="btn" onClick={() => runScenario(scenario)} disabled={running || scenario.id === "custom"}>
            {running && scenario.id !== "custom" ? "running…" : "▶ run this scenario live"}
          </button>
          {(slog.length > 0 || serr) && <button className="btn ghost" onClick={resetRun} disabled={running}>reset</button>}
          <span className="mono faint" style={{ fontSize: 10.5 }}>
            real flow against {config.provider.id} · the diagram below tracks it live
          </span>
        </div>

        <details className="custom-builder">
          <summary><span className="cb-plus">＋</span> Build your own REED scenario<span className="ex-caret">▾</span></summary>
          <div className="custom-builder-body">
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
              Pick any partner identity (BPN) and any asset, then run it for real. The catalogue layer decides whether that partner can even discover it — so this is also how you demonstrate a <b>denial</b>.
            </p>
            <div className="cb-row">
              <label className="cb-field">
                <span>Consumer BPN</span>
                <select className="field" value={cBpn} onChange={(e) => setCBpn(e.target.value)} disabled={running}>
                  {config.bpns.map((b) => <option key={b.bpn} value={b.bpn}>{b.label} · {b.bpn}</option>)}
                </select>
              </label>
              <label className="cb-field">
                <span>…or custom BPN</span>
                <input className="field" placeholder="BPN-…" value={cBpnText} onChange={(e) => setCBpnText(e.target.value)} disabled={running} />
              </label>
              <label className="cb-field">
                <span>Asset</span>
                <select className="field" value={cAsset} onChange={(e) => setCAsset(e.target.value)} disabled={running}>
                  {assetIds.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <button className="btn" style={{ alignSelf: "flex-end" }} onClick={runCustom} disabled={running}>
                {running && scenario.id === "custom" ? "running…" : "▶ run custom"}
              </button>
            </div>
            <div className="cb-examples">
              <span className="cb-ex-label">examples</span>
              {[
                { bpn: "BPN-REED-SUP-0002", asset: "process-capability-001", note: "supplier → confidential, granted" },
                { bpn: "BPN-REED-SUP-0002", asset: "digital-product-passport-001", note: "any member → consortium, granted" },
                { bpn: "BPN-REED-SIM-0003", asset: "production-status-001", note: "project partner → restricted, granted" },
                { bpn: "BPN-REED-OUT-9999", asset: "quality-evidence-001", note: "outsider → regulated, DENIED" },
                { bpn: "BPN-REED-SIM-0003", asset: "process-capability-001", note: "wrong relation → DENIED" },
              ].map((ex) => (
                <button key={ex.bpn + ex.asset} className="cb-ex" disabled={running} onClick={() => { setCBpnText(""); setCBpn(ex.bpn); setCAsset(ex.asset); }} title={`load ${ex.bpn} + ${ex.asset}`}>
                  <span className="mono">{ex.bpn.replace("BPN-REED-", "")}</span> + <span className="mono">{ex.asset}</span>
                  <span className="cb-ex-note">{ex.note}</span>
                </button>
              ))}
            </div>
          </div>
        </details>

        <Topology key={scenario.id} active={running || denied || payload ? stageToStep(stage) : undefined} interactive={!(running || denied || payload)} consumerLabel={consumerLabel} />

        {(slog.length > 0 || serr) && (
          <div className="scenario-result">
            {serr && <div className="error" style={{ marginBottom: 8 }}>✕ {serr}</div>}
            {denied && (
              <div className="denied-banner">
                access denied at the <b>catalogue layer</b> — {scenario.consumerBpn} has no supply-chain relation that makes <span className="mono">{scenario.asset}</span> discoverable. No offer → no contract → no payload.
              </div>
            )}
            <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.9, color: "var(--text-dim)" }}>
              {slog.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            {payload && (
              <>
                <div className="panel-head" style={{ margin: "12px -14px 8px", paddingLeft: 14 }}>confidential payload · post-contract</div>
                <Json value={safeParse(payload)} />
              </>
            )}
          </div>
        )}
      </Panel>

      <div style={{ marginTop: 14 }}>
        <NetworkReference />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginTop: 14 }}>
        <Panel title="Where to start · the workflow">
          <GuidedPath
            onJump={onJump}
            items={[
              { n: 1, title: "Catalogue — discover by BPN", desc: "See exactly what a partner is allowed to find. The catalogue layer in action.", to: "catalogue" },
              { n: 2, title: "Negotiate — contract → EDR → pull", desc: "Run the full flow live and watch this diagram light up step by step.", to: "negotiate" },
              { n: 3, title: "Transfers — contract states", desc: "Confirm the negotiation FINALIZED and the transfer STARTED on the connector.", to: "transfers" },
              { n: 4, title: "Audit — the access trail", desc: "Every discover / negotiate / pull is logged. The accountability record.", to: "audit" },
            ]}
          />
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
      <Explainer help={TAB_HELP.matrix} />
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
      <Explainer help={TAB_HELP.catalogue} />
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
      <Explainer help={TAB_HELP.policies} />
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
      <Explainer help={TAB_HELP.edc} />
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
      <Explainer help={TAB_HELP.transfers} />
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
      <Explainer help={TAB_HELP.audit} />
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

/** Map the live negotiation stage onto the shared topology diagram's step. */
function stageToStep(stage: number): StepId | null {
  switch (stage) {
    case 0: return "discover";
    case 1:
    case 2: return "negotiate";
    case 3: return "transfer";
    case 4:
    case 5: return "edr";
    case 6: return "pull";
    default: return null;
  }
}

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
      const data = await runReedFlow(api, assetId, { onStage: setStage, onLog: add });
      setPayload(data);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <SectionHead idx="03 /" title="Negotiate · Consumer Pull" desc={`Run the full contract flow from ${config.consumerManagementUrl.includes("29193") ? "consumer-1" : "the consumer"} against ${config.provider.id}: negotiate → FINALIZED → transfer → EDR → pull.`} />
      <Explainer help={TAB_HELP.negotiate} />

      <Panel title="live flow · control plane ⇄ data plane" right={<span className="mono faint" style={{ fontSize: 10.5 }}>{running ? "running…" : stage >= 6 ? "complete" : stage >= 0 ? "in progress" : "idle"}</span>}>
        <Topology active={stageToStep(stage)} interactive={false} />
      </Panel>

      <div className="flowbar" style={{ margin: "16px 0" }}>
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
