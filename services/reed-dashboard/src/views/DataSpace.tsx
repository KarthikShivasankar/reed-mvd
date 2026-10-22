import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "../App";
import { go } from "../App";
import {
  Access, AssetAccess, InteropRequest, InteropScenario, Offer, Participant, PolicyTemplate, runReedFlow,
} from "../api";
import type { ConnectorRef } from "../config";
import { CertChips, DiscoverabilityChip, Json, Panel, SensitivityChip, Status, TemplateChip, useAsync, useToast } from "../ui";
import { Explainer, TAB_HELP } from "../guide";
import { StatusChip } from "./Factory";

/* =========================================================================
   Data space: what sharing through REED gives each company, live.
   Owners set terms and see who would get their data before anyone asks;
   requesters see what their credentials open; every claim can be tried
   against the real connectors.
   ========================================================================= */

type Tab = "terms" | "get" | "stories" | "why";
const TABS: [Tab, string][] = [["terms", "My data, my terms"], ["get", "What I can get"], ["stories", "Cross-border stories"], ["why", "Why a data space"]];

const DISCOVER: Record<string, string> = {
  consortium: "every consortium member finds it",
  bilateral: "only companies in a supply relation with you",
  project: "only companies in a shared project with you",
};

export function DataSpace({ ctx }: { ctx: Ctx }) {
  const companies = ctx.config.connectors;
  const own = companies.find((c) => c.name === ctx.session.participant);
  const [asName, setAsName] = useState(own?.name ?? companies[0]?.name);
  const as = ctx.operator ? companies.find((c) => c.name === asName) : own;
  const [tab, setTab] = useState<Tab>(() => (sessionGet("reed.ds.tab") as Tab) || "terms");
  const parts = useAsync(() => ctx.api.participants(), [ctx.api]);
  const byBpn = useMemo(() => Object.fromEntries((parts.data ?? []).map((p) => [p.bpn, p])), [parts.data]);
  useEffect(() => sessionSet("reed.ds.tab", tab), [tab]);

  if (!as) {
    return (
      <>
        <Head />
        <div className="empty">Your organisation runs no EDC connector yet: you can be matched, but data is shared connector to connector.</div>
      </>
    );
  }

  return (
    <>
      <Head />
      <Explainer help={TAB_HELP.dataspace} />
      <div className="controls">
        <div className="seg" role="tablist" aria-label="Data space">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {ctx.operator && (
          <label className="inline">Look as
            <select className="field" value={asName} onChange={(e) => setAsName(e.target.value)}>
              {companies.map((c) => <option key={c.name} value={c.name}>{c.company}</option>)}
            </select>
          </label>
        )}
        {ctx.operator && <span className="note">Operator: you can look as any company and act through its connector, but only an owner changes its terms.</span>}
      </div>

      {tab === "terms" && <Terms key={as.name} ctx={ctx} as={as} byBpn={byBpn} />}
      {tab === "get" && <Get key={as.name} ctx={ctx} as={as} byBpn={byBpn} />}
      {tab === "stories" && <Stories ctx={ctx} as={as} />}
      {tab === "why" && <Why onTab={setTab} />}
    </>
  );
}

function Head() {
  return (
    <div className="view-head">
      <h1>Data space</h1>
      <p className="muted">Seven companies in five European countries share data connector to connector. Each owner decides who finds its data
        and who gets a contract; every connector checks those terms against the requester's verifiable credentials.</p>
    </div>
  );
}

/* ------------------------------------------------------------ lamps */

type LampState = "on" | "warn" | "off" | "na";

/** Two signals per company: finds it / gets a contract. Icon and text, never colour alone. */
function Lamps({ a, flash, draft }: { a: Access; flash?: boolean; draft?: boolean }) {
  const find: LampState = a.visible ? "on" : "off";
  const deal: LampState = !a.visible ? "na" : a.granted ? "on" : "warn";
  const label = !a.visible ? `${a.company} does not find it` : a.granted ? `${a.company} finds it and gets a contract` : `${a.company} finds it but is refused: ${a.contractReason}`;
  return (
    <span className={`lamps ${flash ? "flash" : ""} ${draft ? "draft" : ""}`} title={label} aria-label={label} role="img">
      <span className={`lamp lamp-${find}`} aria-hidden>{a.visible ? "◉" : "○"}</span>
      <span className={`lamp lamp-${deal}`} aria-hidden>{!a.visible ? "·" : a.granted ? "✓" : "✕"}</span>
    </span>
  );
}

function Flag({ country }: { country?: string | null }) {
  return <span className="org-flag">{country ?? "EU"}</span>;
}

/* ------------------------------------------------------------ owner: my data, my terms */

function Terms({ ctx, as, byBpn }: { ctx: Ctx; as: ConnectorRef; byBpn: Record<string, Participant> }) {
  const toast = useToast();
  const access = useAsync(() => ctx.api.policyAccess(ctx.operator ? as.bpn : undefined), [ctx.api, as.bpn]);
  const templates = useAsync(() => ctx.api.policyTemplates(), [ctx.api]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ discoverability: string; policyTemplate: string } | null>(null);
  const [preview, setPreview] = useState<AssetAccess | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const owner = !ctx.operator && ctx.session.bpn === as.bpn;

  const assets = access.data ?? [];
  const current = assets.find((a) => a.assetId === selected) ?? null;
  useEffect(() => { if (!selected && assets.length) setSelected(assets[0].assetId); }, [assets, selected]);
  useEffect(() => { setDraft(current ? { discoverability: current.discoverability, policyTemplate: current.policyTemplate } : null); setPreview(null); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.assetId, current?.discoverability, current?.policyTemplate]);

  const changed = !!(current && draft && (draft.discoverability !== current.discoverability || draft.policyTemplate !== current.policyTemplate));
  useEffect(() => {
    if (!current || !draft || !changed) { setPreview(null); return; }
    let live = true;
    ctx.api.policyPreview(current.assetId, draft.discoverability, draft.policyTemplate)
      .then((p) => live && setPreview(p)).catch((e) => toast("error", e.message));
    return () => { live = false; };
  }, [ctx.api, current, draft, changed, toast]);

  const shown = (a: AssetAccess) => (preview && a.assetId === preview.assetId ? preview : a);
  const rows = assets[0]?.access ?? [];
  const tmpl = (templates.data ?? []).find((t) => t.name === draft?.policyTemplate);
  const sel = current ? shown(current) : null;

  async function publish() {
    if (!current || !draft) return;
    setBusy(true);
    try {
      const after = await ctx.api.setPolicy(current.assetId, draft.discoverability, draft.policyTemplate);
      const diff = new Set(after.access.filter((n) => {
        const o = current.access.find((x) => x.bpn === n.bpn);
        return !o || o.visible !== n.visible || o.granted !== n.granted;
      }).map((n) => `${after.assetId}/${n.bpn}`));
      setFlash(diff);
      window.setTimeout(() => setFlash(new Set()), 1600);
      toast("ok", `Published to ${as.short}'s connector: ${diff.size} compan${diff.size === 1 ? "y's" : "ies'"} access changed`);
      access.reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Status loading={access.loading && !access.data} error={access.error} empty={assets.length === 0}
            emptyText={`${as.short} offers no data assets yet.`}>
      <Panel title={`Who gets ${as.short}'s data`} right={<span className="lamp-legend">
        <span><span className="lamp lamp-on">◉</span> finds it</span>
        <span><span className="lamp lamp-on">✓</span> contract</span>
        <span><span className="lamp lamp-warn">✕</span> refused</span>
        <span><span className="lamp lamp-off">○</span> hidden</span></span>}>
        <div className="board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th scope="col">Company</th>
                {assets.map((a) => (
                  <th key={a.assetId} scope="col" className={a.assetId === selected ? "sel" : ""}>
                    <button className="board-asset" onClick={() => setSelected(a.assetId)} aria-pressed={a.assetId === selected}>
                      <span className="asset-name">{a.assetClass.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
                      <span className="faint">{shown(a).policyTemplate}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bpn}>
                  <th scope="row"><Flag country={r.country} /> {r.company} <span className="faint">{role(r.role)}</span>
                    {byBpn[r.bpn]?.illustrative && <span className="note"> illustrative</span>}</th>
                  {assets.map((a) => {
                    const cell = shown(a).access.find((x) => x.bpn === r.bpn)!;
                    return (
                      <td key={a.assetId} className={a.assetId === selected ? "sel" : ""}>
                        <Lamps a={cell} flash={flash.has(`${a.assetId}/${r.bpn}`)} draft={!!preview && a.assetId === preview.assetId} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {current && draft && sel && (
        <div className="terms-grid">
          <Panel title={current.title} right={<SensitivityChip value={current.sensitivity} />}>
            <div className="terms-form">
              <div>
                <div className="field-label">Who can find it</div>
                <div className="seg">
                  {Object.keys(DISCOVER).map((d) => (
                    <button key={d} className={draft.discoverability === d ? "active" : ""} disabled={!owner}
                            onClick={() => setDraft({ ...draft, discoverability: d })}>{d}</button>
                  ))}
                </div>
                <p className="note">{DISCOVER[draft.discoverability]}</p>
              </div>
              <div>
                <label className="field-label" htmlFor="tmpl">Contract terms</label>
                <select id="tmpl" className="field" value={draft.policyTemplate} disabled={!owner}
                        onChange={(e) => setDraft({ ...draft, policyTemplate: e.target.value })}>
                  {(templates.data ?? []).map((t: PolicyTemplate) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
                {tmpl && <p className="note">{tmpl.description}</p>}
              </div>
              <div className="terms-need">
                <div><span className="faint">To find it:</span> {sel.discoverTerms.join(" and ")}</div>
                <div><span className="faint">To get a contract:</span> {sel.contractTerms.join(" and ")}</div>
              </div>
              {owner ? (
                <div className="row">
                  <button className="btn" onClick={publish} disabled={!changed || busy}>{busy ? "Publishing…" : "Publish to my connector"}</button>
                  <button className="btn ghost" onClick={() => setDraft({ discoverability: current.discoverability, policyTemplate: current.policyTemplate })}
                          disabled={!changed || busy}>Discard changes</button>
                  {changed && <span className="note">Preview only: nothing changes until you publish.</span>}
                </div>
              ) : (
                <p className="note">Only {as.short} can change these terms - REED and the dataspace operator cannot.</p>
              )}
              <p className="note">Contracts already signed keep the terms they were signed under; the next catalogue request and negotiation see the new ones.</p>
            </div>
          </Panel>
          <Panel title={changed ? "If you publish" : "Right now"}>
            <ul className="why-list">
              {sel.access.map((r) => (
                <li key={r.bpn} className={flash.has(`${sel.assetId}/${r.bpn}`) ? "flash" : ""}>
                  <Lamps a={r} draft={changed} />
                  <span><Flag country={r.country} /> <strong>{r.company}</strong>{" "}
                    <span className="muted">{!r.visible ? `cannot find it: ${r.discoverReason}` : r.granted ? `gets a contract: ${r.contractReason}` : `is refused: ${r.contractReason}`}</span>
                    {byBpn[r.bpn]?.illustrative && <span className="note"> (illustrative)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </Status>
  );
}

const role = (r: string) => (r === "OEM" ? "OEM" : r === "SERVICE" ? "service" : "supplier");

/* ------------------------------------------------------------ requester: what I can get */

function Get({ ctx, as, byBpn }: { ctx: Ctx; as: ConnectorRef; byBpn: Record<string, Participant> }) {
  const inbound = useAsync(() => ctx.api.inbound(ctx.operator ? as.bpn : undefined), [ctx.api, as.bpn]);
  const c = inbound.data?.claims;
  const names = (bpns: string[]) => bpns.map((b) => byBpn[b]?.shortName ?? b).join(", ") || "none";
  const groups = useMemo(() => {
    const g: Record<string, Offer[]> = {};
    for (const o of inbound.data?.offers ?? []) (g[o.owner] ??= []).push(o);
    return Object.entries(g);
  }, [inbound.data]);

  return (
    <Status loading={inbound.loading && !inbound.data} error={inbound.error}>
      <Panel title={`What ${as.short}'s connector proves about it`} right={<span className="faint">verifiable credentials from the REED issuer, presented on every request</span>}>
        {c && c.member ? (
          <dl className="wallet">
            <div><dt>Membership</dt><dd>active</dd></div>
            <div><dt>Role</dt><dd>{c.role}</dd></div>
            <div><dt>Registered in</dt><dd><Flag country={c.country} /></dd></div>
            <div><dt>Certifications</dt><dd>{c.certifications.length ? <CertChips verified={c.certifications} /> : "none verified"}</dd></div>
            <div><dt>Supply relations</dt><dd>{names(c.partners)}</dd></div>
            <div><dt>Shared projects</dt><dd>{names(c.projects)}</dd></div>
          </dl>
        ) : <div className="empty">No credentials: not a consortium member, so no connector shows it anything.</div>}
      </Panel>
      <p className="note">Only what {as.short} may discover is listed. Data it may not discover stays invisible: even that it exists is the owner's business.</p>
      {groups.map(([owner, offers]) => (
        <Panel key={owner} title={`From ${owner}${byBpn[offers[0].ownerBpn]?.illustrative ? " (illustrative: real company, invented data)" : ""}`}
               right={<Flag country={offers[0].ownerCountry} />}>
          <ul className="offers">
            {offers.map((o) => <OfferRow key={o.assetId} ctx={ctx} as={as} o={o} />)}
          </ul>
        </Panel>
      ))}
    </Status>
  );
}

const STAGES = ["Asking for the catalogue", "Negotiating", "Contract agreed", "Starting the transfer", "Transfer started", "Access token issued", "Payload received"];

function OfferRow({ ctx, as, o }: { ctx: Ctx; as: ConnectorRef; o: Offer }) {
  const [stage, setStage] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; payload?: any } | null>(null);
  const provider = ctx.config.connectors.find((c) => c.name === o.ownerConnector)!;

  async function run() {
    setResult(null);
    try {
      const r = await runReedFlow(ctx.api, as.name, provider, o.assetId, { onStage: setStage });
      let payload: any = r.payload;
      try { payload = JSON.parse(r.payload); } catch { /* raw */ }
      setResult({ ok: true, text: `Contract ${r.agreementId.slice(0, 8)} signed; payload received through ${provider.short}'s data plane`, payload });
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setStage(null);
    }
  }

  return (
    <li className="offer">
      <div className="offer-main">
        <span className={`lamp lamp-${o.granted ? "on" : "warn"}`} aria-hidden>{o.granted ? "✓" : "✕"}</span>
        <div>
          <div className="asset-name">{o.title}</div>
          <div className="muted">{o.granted ? `Contract possible: ${o.reason}` : `${provider.short} will refuse: ${o.reason}`}</div>
          <div className="row"><SensitivityChip value={o.sensitivity} /><TemplateChip value={o.policyTemplate} /></div>
        </div>
        <button className={`btn ${o.granted ? "" : "ghost"}`} onClick={run} disabled={stage !== null}>
          {stage !== null ? STAGES[stage] + "…" : o.granted ? "Get it" : "Try anyway"}
        </button>
      </div>
      {result && (
        <div className={result.ok ? "ok-box" : "error-box"}>
          {result.ok ? result.text : `Refused by ${provider.short}'s connector: ${result.text}`}
          {result.payload && <Payload p={result.payload} />}
        </div>
      )}
    </li>
  );
}

function Payload({ p }: { p: any }) {
  const lic = p?._reedLicense;
  const floor = p?.shopFloor;
  return (
    <div className="payload">
      {lic && (
        <dl className="wallet compact">
          <div><dt>Licensed to</dt><dd className="mono">{lic.licensee}</dd></div>
          <div><dt>Valid until</dt><dd>{lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString() : "no expiry"}</dd></div>
          <div><dt>Not allowed</dt><dd>{(lic.prohibitions ?? []).join(", ") || "—"}</dd></div>
          <div><dt>Watermark</dt><dd className="mono" title={lic.watermark}>{String(lic.watermark).slice(0, 16)}…</dd></div>
        </dl>
      )}
      {floor && (
        <div className="floor">
          <div className="field-label">{floor.line}, right now</div>
          <ul>
            {floor.machines.map((m: any) => (
              <li key={m.machine}><StatusChip status={m.status} /> {m.machine}{m.findings.length > 0 && <span className="muted"> - {m.findings[0]}</span>}</li>
            ))}
          </ul>
        </div>
      )}
      <details><summary className="note">Whole payload</summary><Json value={p} /></details>
    </div>
  );
}

/* ------------------------------------------------------------ cross-border stories */

function Stories({ ctx, as }: { ctx: Ctx; as: ConnectorRef }) {
  const s = useAsync(() => ctx.api.interopScenarios(), [ctx.api]);
  return (
    <Status loading={s.loading} error={s.error}>
      <p className="note">Each story is checked end to end by <span className="mono">./run-interop.sh</span> against the real connectors.
        {" "}You can try the requests made by {as.short} live.</p>
      <div className="stories">
        {(s.data?.scenarios ?? []).map((x) => <Story key={x.id} ctx={ctx} as={as} s={x} />)}
      </div>
    </Status>
  );
}

function Story({ ctx, as, s }: { ctx: Ctx; as: ConnectorRef; s: InteropScenario }) {
  const toast = useToast();
  const owner = ctx.config.connectors.find((c) => c.name === s.owner)!;
  const isOwner = !ctx.operator && ctx.session.participant === s.owner;
  const [predicted, setPredicted] = useState<AssetAccess | null>(null);
  const [before, setBefore] = useState<{ discoverability: string; policyTemplate: string } | null>(null);

  async function predict() {
    try {
      const terms = s.terms ?? (await ctx.api.policyAccess(ctx.operator ? owner.bpn : undefined)).find((a) => a.assetId === s.asset);
      if (!terms) return;
      setPredicted(await ctx.api.policyPreview(s.asset, terms.discoverability, terms.policyTemplate));
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  async function apply(undo: boolean) {
    try {
      if (undo && before) {
        await ctx.api.setPolicy(s.asset, before.discoverability, before.policyTemplate);
        setBefore(null);
        toast("ok", `Restored ${s.asset} to ${before.policyTemplate}`);
      } else if (s.terms) {
        const now = (await ctx.api.policyAccess()).find((a) => a.assetId === s.asset);
        if (now) setBefore({ discoverability: now.discoverability, policyTemplate: now.policyTemplate });
        await ctx.api.setPolicy(s.asset, s.terms.discoverability, s.terms.policyTemplate);
        toast("ok", `Published ${s.terms.policyTemplate} for ${s.asset}`);
      }
      setPredicted(null);
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  return (
    <article className="story">
      <header>
        <span className="story-id mono">{s.id}</span>
        <h3>{s.title}</h3>
      </header>
      <p className="muted">{s.story}</p>
      <div className="row">
        <span>{owner.short}</span> <span className="faint mono">{s.asset}</span>
        {s.terms ? <><DiscoverabilityChip value={s.terms.discoverability} /><TemplateChip value={s.terms.policyTemplate} /></>
          : <span className="note">current terms</span>}
      </div>
      <ul className="story-reqs">
        {s.requests.map((r) => (
          <StoryRequest key={r.consumer} ctx={ctx} as={as} s={s} r={r}
                        predicted={predicted?.access.find((a) => a.connector === r.consumer)} />
        ))}
      </ul>
      <div className="row">
        {(ctx.operator || isOwner) && <button className="btn ghost" onClick={predict}>Predict</button>}
        {isOwner && s.terms && !before && <button className="btn" onClick={() => apply(false)}>Apply these terms</button>}
        {isOwner && before && <button className="btn ghost" onClick={() => apply(true)}>Restore my terms</button>}
        {!isOwner && s.terms && <span className="note">The requests below follow these terms once {owner.short} applies them.</span>}
      </div>
    </article>
  );
}

const EXPECT: Record<InteropRequest["expect"], [LampState, string, string]> = {
  FINALIZED: ["on", "✓", "gets a contract"],
  TERMINATED: ["warn", "✕", "is refused"],
  HIDDEN: ["off", "○", "does not find it"],
};

function StoryRequest({ ctx, as, s, r, predicted }: { ctx: Ctx; as: ConnectorRef; s: InteropScenario; r: InteropRequest; predicted?: Access }) {
  const consumer = ctx.config.connectors.find((c) => c.name === r.consumer)!;
  const owner = ctx.config.connectors.find((c) => c.name === s.owner)!;
  const [state, icon, words] = EXPECT[r.expect];
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<string | null>(null);
  const pred = predicted ? (!predicted.visible ? "HIDDEN" : predicted.granted ? "FINALIZED" : "TERMINATED") : null;

  async function tryIt() {
    setBusy(true);
    setGot(null);
    try {
      const res = await runReedFlow(ctx.api, consumer.name, owner, s.asset, { onStage: () => {} });
      setGot(`Contract ${res.agreementId.slice(0, 8)} signed, payload received`);
    } catch (e: any) {
      setGot(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <span className={`lamp lamp-${state}`} aria-hidden>{icon}</span>
      <span><strong>{consumer.short}</strong> {words}{r.reason && <span className="faint"> on {r.reason}</span>}
        {pred && <span className={pred === r.expect ? "note" : "error-text"}> · REED predicts {EXPECT[pred as InteropRequest["expect"]][2]}</span>}
        {got && <div className="faint">{got}</div>}
      </span>
      {(r.consumer === as.name) && (
        <button className="btn ghost sm" onClick={tryIt} disabled={busy}>{busy ? "Asking…" : "Try it now"}</button>
      )}
    </li>
  );
}

/* ------------------------------------------------------------ why */

function Why({ onTab }: { onTab: (t: Tab) => void }) {
  const items: [string, string, string, () => void][] = [
    ["The owner keeps control", "Each company publishes only metadata and decides, per asset, who finds it and who may sign. A change takes effect on its own connector at once; nobody else - not REED, not the operator - can change it.", "Set terms", () => onTab("terms")],
    ["Trust without a central database", "A company proves its role, seat, certifications and supply relations with verifiable credentials. The other side's connector checks them on every request; no shared password, no central copy of the data.", "See your credentials", () => onTab("get")],
    ["One protocol across borders", "Norwegian, German, Spanish, Polish and Dutch companies use the same Dataspace Protocol and ODRL policies. EU and EEA rules become policy constraints, not paperwork.", "Cross-border stories", () => onTab("stories")],
    ["Find first, receive after a contract", "Discovering that data exists is separate from receiving it. The payload leaves the owner's data service only after a contract, through the owner's data plane.", "Contracts", () => go("transfers")],
    ["Accountable use", "Every released payload carries a licence (licensee, expiry, prohibitions) and a watermark tying a copy to its licensee; every release is audited.", "Audit trail", () => go("audit")],
    ["Live operations as a data product", "A supplier's shop floor - sensors analysed every minute - reaches a customer only inside its production-status payload, under a contract and a time-limited licence.", "Shop floor", () => go("factory")],
  ];
  return (
    <Panel>
      <dl className="why">
        {items.map(([t, d, cta, act]) => (
          <div key={t}>
            <dt>{t}</dt>
            <dd><p>{d}</p><button className="btn ghost sm" onClick={act}>{cta}</button></dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* sessionStorage may be unavailable (private mode, blocked storage): the tab is then simply not remembered */
function sessionGet(k: string): string | null {
  try { return window.sessionStorage.getItem(k); } catch { return null; }
}
function sessionSet(k: string, v: string) {
  try { window.sessionStorage.setItem(k, v); } catch { /* not remembered */ }
}
