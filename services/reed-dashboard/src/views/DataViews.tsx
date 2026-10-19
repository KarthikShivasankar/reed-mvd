import { useCallback, useEffect, useRef, useState } from "react";
import type { Ctx } from "../App";
import { AuditEvent, datasetsOf, policyReason, prop } from "../api";
import {
  CertChips, DiscoverabilityChip, Json, Led, Panel, SensitivityChip, Status, TemplateChip, fmtDims, fmtMass, useAsync,
} from "../ui";
import { Explainer, TAB_HELP } from "../guide";

function Head({ title, lede }: { title: string; lede: string }) {
  return (
    <div className="view-head">
      <h1>{title}</h1>
      <p className="muted">{lede}</p>
    </div>
  );
}

/* ------------------------------------------------------------- Catalogue */
export function Catalogue({ ctx }: { ctx: Ctx }) {
  const { api, operator } = ctx;
  const parts = useAsync(() => api.participants(), [api]);
  const [as, setAs] = useState<string>("");
  const cat = useAsync(() => api.catalogue(as || undefined), [api, as]);
  const owner = (bpn: string) => parts.data?.find((p) => p.bpn === bpn)?.shortName ?? bpn;
  const subject = as ? owner(as) : ctx.me.organisation?.shortName ?? "you";

  return (
    <>
      <Head title="Catalogue" lede={`What ${subject} can discover across the data space. Bilateral assets need a supply relation with their owner, project assets a shared project.`} />
      <Explainer help={TAB_HELP.catalogue} />
      {operator && (
        <div className="controls">
          <label className="inline">See the catalogue as
            <select className="field" value={as} onChange={(e) => setAs(e.target.value)}>
              <option value="">(operator)</option>
              {parts.data?.map((p) => <option key={p.bpn} value={p.bpn}>{p.shortName} · {p.bpn}</option>)}
            </select>
          </label>
        </div>
      )}
      <Panel title={`Visible to ${subject}`} right={<span className="faint">{cat.data?.length ?? 0} assets</span>}>
        <Status loading={cat.loading} error={cat.error} empty={(cat.data ?? []).length === 0}
                emptyText="Nothing is discoverable - non-members see nothing, and a member always sees at least consortium-wide assets.">
          <table className="grid">
            <thead><tr><th>Asset</th><th>Owner</th><th>Sensitivity</th><th>Who can find it</th><th>Contract terms</th></tr></thead>
            <tbody>
              {cat.data?.map((a) => (
                <tr key={a.assetId}>
                  <td><div className="asset-name">{a.title}</div><div className="asset-id">{a.assetId}</div></td>
                  <td>{owner(a.ownerBpn)}</td>
                  <td><SensitivityChip value={a.sensitivity} /></td>
                  <td><DiscoverabilityChip value={a.discoverability} /></td>
                  <td><TemplateChip value={a.policyTemplate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Status>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------- Contracts */
export function Transfers({ ctx }: { ctx: Ctx }) {
  const { api } = ctx;
  const connectors = ctx.operator ? ctx.config.connectors.map((c) => c.name) : [ctx.session.participant!];
  const [name, setName] = useState(connectors[0]);
  const negs = useAsync(() => api.list(name, "contractnegotiations"), [api, name]);
  const tps = useAsync(() => api.list(name, "transferprocesses"), [api, name]);
  const company = ctx.config.connectors.find((c) => c.name === name)?.short ?? name;
  const short = (did?: string) => ctx.config.connectors.find((c) => c.participantId === did)?.short ?? did ?? "—";

  return (
    <>
      <Head title="Contracts" lede={`Contract negotiations and data transfers on ${company}'s EDC connector.`} />
      <Explainer help={TAB_HELP.transfers} />
      {connectors.length > 1 && (
        <div className="controls">
          <div className="seg">
            {connectors.map((c) => <button key={c} className={c === name ? "active" : ""} onClick={() => setName(c)}>{c}</button>)}
          </div>
        </div>
      )}
      <div className="stack">
        <Panel title="Contract negotiations" right={<button className="btn ghost" onClick={negs.reload}>Refresh</button>}>
          <Status loading={negs.loading} error={negs.error} empty={(negs.data ?? []).length === 0} emptyText="No negotiations yet.">
            <table className="grid">
              <thead><tr><th>Negotiation</th><th>Role</th><th>Counterparty</th><th>State</th><th>Reason</th></tr></thead>
              <tbody>
                {negs.data?.map((n) => (
                  <tr key={n["@id"]}>
                    <td className="asset-id">{n["@id"]}</td>
                    <td>{n.type === "PROVIDER" ? "we provide" : "we consume"}</td>
                    <td>{short(n.counterPartyId)}</td>
                    <td><EdcState state={n.state} /></td>
                    <td className="muted">{n.state === "TERMINATED" ? policyReason(n.errorDetail) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Status>
        </Panel>
        <Panel title="Transfers" right={<button className="btn ghost" onClick={tps.reload}>Refresh</button>}>
          <Status loading={tps.loading} error={tps.error} empty={(tps.data ?? []).length === 0} emptyText="No transfers yet.">
            <table className="grid">
              <thead><tr><th>Transfer</th><th>Asset</th><th>Type</th><th>State</th></tr></thead>
              <tbody>
                {tps.data?.map((t) => (
                  <tr key={t["@id"]}>
                    <td className="asset-id">{t["@id"]}</td>
                    <td className="mono">{t.assetId ?? "—"}</td>
                    <td>{t.transferType}</td>
                    <td><EdcState state={t.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Status>
        </Panel>
      </div>
    </>
  );
}

function EdcState({ state }: { state?: string }) {
  const s = state ?? "—";
  const cls = /FINALIZED|STARTED|COMPLETED/.test(s) ? "state-confirmed" : /TERMINAT|ERROR/.test(s) ? "state-rejected" : "state-shortlisted";
  return <span className={`state ${cls}`}>{s.toLowerCase()}</span>;
}

/* ----------------------------------------------------------- EDC catalog */
export function EdcCatalog({ ctx }: { ctx: Ctx }) {
  const { data, error, loading, reload } = useAsync(() => ctx.api.federatedCatalog(), [ctx.api]);
  const short = (did?: string) => ctx.config.connectors.find((c) => c.participantId === did)?.company ?? did ?? "—";
  return (
    <>
      <Head title="EDC catalog" lede="What the federated catalog crawled from every member's connector, using the operator's own credentials. Metadata only." />
      <Explainer help={TAB_HELP.edc} />
      <Panel title="Federated catalog" right={<button className="btn ghost" onClick={reload}>Refresh</button>}>
        <Status loading={loading} error={error} empty={(data ?? []).length === 0}
                emptyText="Nothing crawled yet. Seed the connectors (./seed-reed.sh) and wait about 15 seconds.">
          <div className="fc">
            {data?.map((cat) => (
              <div key={cat.participantId ?? cat["@id"]} className="fc-member">
                <h3 className="h-small">{short(cat.participantId)}</h3>
                <table className="grid compact">
                  <tbody>
                    {datasetsOf(cat).map((d) => (
                      <tr key={d["@id"]}>
                        <td className="asset-id">{d["@id"]}</td>
                        <td>{prop(d, "assetClass") ?? "—"}</td>
                        <td>{prop(d, "sensitivity") ? <SensitivityChip value={String(prop(d, "sensitivity"))} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Status>
      </Panel>
    </>
  );
}

/* ----------------------------------------------------------------- Audit */
const EVENT_TEXT: Record<string, string> = {
  CLASSIFY: "Classified", DISCOVER: "Discovered", REQUEST: "Requested", NEGOTIATE: "Negotiated",
  PULL: "Payload pulled", MATCH: "Matchmaking", ASSIST: "Assistant",
};

export function Audit({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [type, setType] = useState("");
  const timer = useRef<number | null>(null);
  const poll = useCallback(() => {
    ctx.api.audit().then((d) => { setRows(d); setError(null); }).catch((e) => setError(String(e.message ?? e)));
  }, [ctx.api]);
  useEffect(() => {
    poll();
    if (!live) return;
    timer.current = window.setInterval(poll, 4000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [live, poll]);
  const shown = (rows ?? []).filter((r) => !type || r.eventType === type);

  return (
    <>
      <Head title="Audit trail" lede={ctx.operator ? "Every governed action in the data space, newest first." : `Actions by or concerning ${ctx.me.organisation?.shortName ?? "your organisation"}, newest first.`} />
      <Explainer help={TAB_HELP.audit} />
      <Panel title="Events" right={
        <span className="row">
          <select className="field" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by event type">
            <option value="">All events</option>
            {Object.entries(EVENT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Led online={live ? true : null} label={live ? "Live" : "Paused"} />
          <button className="btn ghost" onClick={() => setLive((l) => !l)}>{live ? "Pause" : "Resume"}</button>
        </span>}>
        <Status loading={rows === null && !error} error={error} empty={shown.length === 0} emptyText="No events yet.">
          <table className="grid">
            <thead><tr><th>Event</th><th>Organisation</th><th>What happened</th><th className="right">When</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td><span className={`evt evt-${e.eventType}`}>{EVENT_TEXT[e.eventType] ?? e.eventType}</span></td>
                  <td className="mono faint">{e.actorBpn ?? "—"}</td>
                  <td>{e.detail}{e.assetId && <span className="asset-id"> · {e.assetId}</span>}</td>
                  <td className="right mono faint">{new Date(e.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Status>
      </Panel>
    </>
  );
}

/* --------------------------------------------------------------- Members */
export function Participants({ ctx }: { ctx: Ctx }) {
  const { data, error, loading } = useAsync(() => ctx.api.participants(), [ctx.api]);
  return (
    <>
      <Head title="Members" lede="Every company in the REED data space: location, what it says it can do, and what a trusted issuer has verified." />
      <Explainer help={TAB_HELP.participants} />
      <Status loading={loading} error={error}>
        <div className="members">
          {data?.map((p) => (
            <article key={p.bpn} className={`member ${p.consortium ? "" : "outside"}`}>
              <header>
                <span className="org-flag">{p.country}</span>
                <div>
                  <h3>{p.name}</h3>
                  <div className="faint">{p.city} · {p.role === "OEM" ? "OEM" : p.role === "SERVICE" ? "Service" : "Supplier"}
                    {p.portAccess && " · quay"}{p.railAccess && " · rail"}</div>
                </div>
              </header>
              {!p.consortium && <div className="warn-box">Not a consortium member</div>}
              {p.illustrative && (
                <div className="warn-box">Real company, illustrative only: its RFQs are invented demo scenarios and nothing here is a claim about it.</div>
              )}
              {p.capability && <p className="member-summary">{p.capability.summary}</p>}
              {p.capability && (
                <dl className="member-facts">
                  <div><dt>Largest part</dt><dd className="mono">{fmtDims(p.capability.envelopeMm)}</dd></div>
                  <div><dt>Max mass</dt><dd className="mono">{fmtMass(p.capability.maxMassKg)}</dd></div>
                  {p.capability.co2KgPerKg != null && <div><dt>CO2e</dt><dd className="mono">{p.capability.co2KgPerKg} kg/kg</dd></div>}
                </dl>
              )}
              <CertChips verified={p.verifiedCerts} claimed={p.capability?.claimedCerts ?? []} />
              <div className="member-foot faint">
                {p.connectorName ? <>EDC connector <span className="mono">{p.connectorName}</span></> : "Directory only (no connector)"}
                {p.did && <div className="mono did">{decodeURIComponent(p.did)}</div>}
              </div>
            </article>
          ))}
        </div>
      </Status>
    </>
  );
}

/* -------------------------------------------------------------- Policies */
export function Policies({ ctx }: { ctx: Ctx }) {
  const { data, error, loading } = useAsync(() => ctx.api.policyTemplates(), [ctx.api]);
  return (
    <>
      <Head title="Policy templates" lede="Permission constraints are checked by every connector against the requester's verifiable credentials; prohibitions and obligations are recorded by REED." />
      <Explainer help={TAB_HELP.policies} />
      <Status loading={loading} error={error}>
        <div className="cards">
          {data?.map((t) => {
            let odrl: unknown = t.odrl;
            try { odrl = JSON.parse(t.odrl); } catch { /* raw */ }
            return (
              <div className="tmpl-card" key={t.name}>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <Json value={odrl} />
              </div>
            );
          })}
        </div>
      </Status>
    </>
  );
}

/* ---------------------------------------------------------------- Matrix */
export function Matrix({ ctx }: { ctx: Ctx }) {
  const { data, error, loading } = useAsync(() => ctx.api.classifications(), [ctx.api]);
  return (
    <>
      <Head title="Classification matrix" lede="Eight asset classes, each with a sensitivity, who may discover it, and its default contract terms." />
      <Explainer help={TAB_HELP.matrix} />
      <Panel>
        <Status loading={loading} error={error}>
          <table className="grid">
            <thead><tr><th>Asset class</th><th>Sensitivity</th><th>Who can find it</th><th>Default terms</th></tr></thead>
            <tbody>
              {data?.map((c) => (
                <tr key={c.assetClass}>
                  <td className="asset-name">{c.assetClass}</td>
                  <td><SensitivityChip value={c.sensitivity} /></td>
                  <td><DiscoverabilityChip value={c.discoverability} /></td>
                  <td><TemplateChip value={c.defaultPolicyTemplate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Status>
      </Panel>
    </>
  );
}
