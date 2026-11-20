import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { go } from "../App";
import type { Ctx } from "../App";
import {
  Condition, ConstraintForm, Contract, DecisionRow, LifecycleStep, Offering, Outcome, Participant, PolicyView, PURPOSES,
  Rfq, ServiceMatch, agree, pullUnder,
} from "../api";
import { Json, Led, Panel, Status, useAsync, useToast } from "../ui";
import { Explainer, TAB_HELP } from "../guide";

/* Manufacturing-as-a-Service with policy enforcement: capability offerings with a compound ODRL policy,
   service RFQs matched in two separate steps (capability, then policy), contracts that carry their effective
   policy as ODRL + Rego, and the Open Policy Agent decisions taken at the provider's connector. */

const EEA = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split(" ");
const CAPABILITIES = ["cnc-machining", "additive-manufacturing", "robot-welding", "predictive-maintenance", "quality-inspection", "digital-twin-simulation"];
const KINDS: [string, string][] = [["SERVICE", "Manufacturing service"], ["DATASET", "Dataset"], ["API", "API"],
  ["AVAILABILITY", "Machine availability"], ["CAPACITY", "Capacity information"], ["PARAMETERS", "Manufacturing parameters"],
  ["DIGITAL_TWIN", "Digital-twin data"]];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/* ------------------------------------------------------------ shared pieces */

/** ALLOW / DENY, always as a word with an icon (never colour alone). */
export function Verdict({ decision, small }: { decision: string; small?: boolean }) {
  const ok = decision === "ALLOW" || decision === "true";
  const text = decision === "true" ? "TRUE" : decision === "false" ? "FALSE" : decision;
  return <span className={`verdict ${ok ? "allow" : "deny"} ${small ? "sm" : ""}`}><span aria-hidden>{ok ? "✓" : "✕"}</span> {text}</span>;
}

/** One line per condition with its outcome. */
export function Conditions({ list }: { list: { label: string; pass: boolean; detail?: string }[] }) {
  return (
    <ul className="conds">
      {list.map((c, i) => (
        <li key={i} className={c.pass ? "pass" : "fail"}>
          <span className="cond-mark" aria-label={c.pass ? "holds" : "failed"}>{c.pass ? "✓" : "✕"}</span>
          <span>{c.label}{c.detail && <span className="faint"> · {c.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** A policy as its individual components, the effective combination, and (on demand) ODRL and Rego. */
export function PolicyBlock({ policy, onRemove }: { policy: PolicyView; onRemove?: (index: number) => void }) {
  return (
    <div className="policy">
      <div className="field-label">Policy components ({policy.components.length})</div>
      {policy.components.length === 0 && <div className="muted">No conditions yet: anyone who asks would be allowed.</div>}
      <ol className="policy-parts">
        {policy.components.map((c, i) => (
          <li key={c.id}>
            {i > 0 && <span className="and" aria-hidden>AND</span>}
            <span className="part"><span className="part-kind">{c.kind.replace("_", " ")}</span>{c.label}
              {onRemove && <button className="part-x" onClick={() => onRemove(i)} aria-label={`Remove: ${c.label}`}>×</button>}
            </span>
          </li>
        ))}
      </ol>
      <div className="field-label">Effective combined policy</div>
      <p className="effective">{policy.effective}</p>
      <details className="policy-code">
        <summary>ODRL policy</summary>
        <Json value={policy.odrl} />
      </details>
      <details className="policy-code">
        <summary>Generated Rego (what Open Policy Agent evaluates)</summary>
        <pre className="code">{policy.rego}</pre>
      </details>
    </div>
  );
}

/** The policy's way from definition to enforcement; a step is lit once it has really happened. */
export function LifecycleRail({ steps }: { steps: LifecycleStep[] }) {
  return (
    <ol className="rail" aria-label="Policy lifecycle">
      {steps.map((s, i) => (
        <li key={s.key} className={s.at ? "done" : "todo"}>
          <span className="rail-n">{s.at ? "✓" : i + 1}</span>
          <span className="rail-label">{s.label}</span>
          <span className="rail-detail">{s.at ? s.detail : "not yet"}</span>
          {s.at && <span className="rail-at">{when(s.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

const STAGE_TEXT: Record<string, string> = { MATCH: "Matchmaking", RUNTIME: "Runtime", SIMULATED: "Simulated" };

/** The decision log: who asked for what, the answer and every failed condition. */
export function DecisionTable({ rows }: { rows: DecisionRow[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <table className="grid">
      <thead><tr><th>Decision</th><th>Stage</th><th>Requester</th><th>Provider</th><th>About</th><th>Why</th><th className="right">When</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.outcome.id ?? i} className="clickable" onClick={() => setOpen(open === i ? null : i)}>
            <td><Verdict decision={r.outcome.decision} small /></td>
            <td>{STAGE_TEXT[r.outcome.stage]}</td>
            <td>{r.requester}</td>
            <td>{r.provider}</td>
            <td>
              <div>{r.contractId ? <a href={`#/agreements/${r.contractId}`} onClick={(e) => e.stopPropagation()}>{r.contractId}</a> : r.offeringId}</div>
              <div className="asset-id">{r.action} {r.assetId}{r.purpose ? ` · purpose ${r.purpose}` : ""}</div>
            </td>
            <td>
              {open === i ? <Conditions list={r.outcome.conditions} />
                : r.outcome.decision === "ALLOW" ? <span className="muted">all {r.outcome.conditions.length} conditions hold</span>
                  : r.outcome.failed.map((f) => f.label).join("; ")}
              <div className="asset-id">policy {r.outcome.policyId} · decided by {r.outcome.decidedBy}</div>
            </td>
            <td className="right mono faint">{when(r.outcome.at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OfferingCard({ o, children }: { o: Offering; children?: ReactNode }) {
  return (
    <article className="story offering">
      <header>
        <span className="org-flag">{o.providerCountry}</span>
        <h3>{o.name}</h3>
        {!o.published && <span className="state state-shortlisted">Draft</span>}
      </header>
      <div className="faint">{o.provider} · {o.capability} · {KINDS.find((k) => k[0] === o.resourceKind)?.[1] ?? o.resourceKind}
        {o.capacityPerMonth != null && ` · ${o.capacityPerMonth} h/month`}</div>
      {o.resource && <div><span className="chip tmpl">{o.resource}</span>{o.assetId && <span className="asset-id"> {o.assetId}</span>}</div>}
      {o.description && <p>{o.description}</p>}
      {o.keywords.length > 0 && <div className="faint mono">{o.keywords.join(" · ")}</div>}
      <PolicyBlock policy={o.policy} />
      {children}
    </article>
  );
}

/* ------------------------------------------------------------ policy builder */

type Preset = { key: string; label: string; input?: "date" | "company" | "purpose"; make: (v: string) => ConstraintForm };
/** The ten policy components a provider can combine. Each is one ODRL constraint; REED rejects what it cannot enforce. */
const PRESETS: Preset[] = [
  { key: "oem", label: "OEMs only", make: () => ({ leftOperand: "MembershipCredential.role", operator: "eq", rightOperand: "OEM" }) },
  { key: "supplier", label: "Suppliers only", make: () => ({ leftOperand: "MembershipCredential.role", operator: "eq", rightOperand: "SUPPLIER" }) },
  { key: "eea", label: "EU/EEA organisations only", make: () => ({ leftOperand: "MembershipCredential.country", operator: "isAnyOf", rightOperand: "$EEA" }) },
  { key: "member", label: "Consortium members only", make: () => ({ leftOperand: "MembershipCredential", operator: "eq", rightOperand: "active" }) },
  { key: "bilateral", label: "Existing bilateral relationship", make: () => ({ leftOperand: "SupplierRelationCredential.partner", operator: "eq", rightOperand: "$OWNER_BPN" }) },
  { key: "noncompete", label: "Non-competing organisations only", make: () => ({ leftOperand: "reed:competitor", operator: "eq", rightOperand: "false" }) },
  { key: "until", label: "Time-limited: until", input: "date", make: (v) => ({ leftOperand: "odrl:dateTime", operator: "lteq", rightOperand: `${v}T23:59:59Z` }) },
  { key: "pilot", label: "Pilot projects only", make: () => ({ leftOperand: "reed:pilotProject", operator: "eq", rightOperand: "true" }) },
  { key: "buyer", label: "A specific buyer", input: "company", make: (v) => ({ leftOperand: "reed:consumer", operator: "eq", rightOperand: v }) },
  { key: "purpose", label: "Purpose of use", input: "purpose", make: (v) => ({ leftOperand: "odrl:purpose", operator: "eq", rightOperand: v }) },
];

/** Compose constraints; every change is translated by the backend, so what is shown is what would be stored. */
function PolicyBuilder({ ctx, value, onChange, companies }: {
  ctx: Ctx; value: ConstraintForm[]; onChange: (v: ConstraintForm[]) => void; companies: Participant[];
}) {
  const [preview, setPreview] = useState<PolicyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arg, setArg] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    ctx.api.translatePolicy(value).then((p) => { if (live) { setPreview(p); setError(null); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [ctx.api, value]);

  return (
    <div className="builder">
      <div className="field-label">Add a condition (all conditions must hold)</div>
      <div className="builder-presets">
        {PRESETS.map((p) => (
          <span key={p.key} className="preset">
            {p.input === "date" && <input type="date" className="field" aria-label={p.label} value={arg[p.key] ?? ""} onChange={(e) => setArg({ ...arg, [p.key]: e.target.value })} />}
            {p.input === "company" && (
              <select className="field" aria-label={p.label} value={arg[p.key] ?? ""} onChange={(e) => setArg({ ...arg, [p.key]: e.target.value })}>
                <option value="">company…</option>
                {companies.filter((c) => c.consortium).map((c) => <option key={c.bpn} value={c.bpn}>{c.shortName}</option>)}
              </select>
            )}
            {p.input === "purpose" && (
              <select className="field" aria-label={p.label} value={arg[p.key] ?? ""} onChange={(e) => setArg({ ...arg, [p.key]: e.target.value })}>
                <option value="">purpose…</option>
                {PURPOSES.map((x) => <option key={x}>{x}</option>)}
              </select>
            )}
            <button type="button" className="btn ghost sm" disabled={!!p.input && !arg[p.key]}
                    onClick={() => onChange([...value, p.make(arg[p.key] ?? "")])}>+ {p.label}</button>
          </span>
        ))}
      </div>
      {error && <div className="error-box">{error}</div>}
      {preview && <PolicyBlock policy={preview} onRemove={(i) => onChange(value.filter((_, j) => j !== i))} />}
    </div>
  );
}

/* ------------------------------------------------------------ Capabilities */

export function Capabilities({ ctx }: { ctx: Ctx }) {
  const { api, session } = ctx;
  const toast = useToast();
  const offerings = useAsync(() => api.offerings(), [api]);
  const companies = useAsync(() => api.participants(), [api]);
  const steward = !ctx.operator && session.has("data-steward") && !!session.bpn;
  const ownAssets = useAsync(() => (steward && session.participant ? api.policyAccess() : Promise.resolve([])), [api, steward]);
  const [form, setForm] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", capability: CAPABILITIES[0], resourceKind: "SERVICE", resource: "", description: "", keywords: "", capacity: "", assetId: "" });
  const [policy, setPolicy] = useState<ConstraintForm[]>([]);
  const [busy, setBusy] = useState(false);
  const taken = new Set((offerings.data ?? []).map((o) => o.assetId));

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast("ok", done);
      setForm(false); setEdit(null); setPolicy([]);
      offerings.reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  const create = () => run(() => api.createOffering({
    name: f.name, capability: f.capability, resourceKind: f.resourceKind, resource: f.resource, description: f.description,
    keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean), capacityPerMonth: f.capacity ? Number(f.capacity) : null,
    assetId: f.assetId || null, policy,
  }), "Capability registered as a draft - publish it to make it matchable");
  /** The stored policy as builder rows (the ODRL constraints of its explicit "and"). */
  const rowsOf = (o: Offering): ConstraintForm[] => (o.policy.odrl?.permission?.[0]?.constraint?.and ?? []);

  return (
    <>
      <div className="view-head">
        <h1>Capabilities</h1>
        <p className="muted">Manufacturing capabilities offered in the data space, each with the access policy its provider attached. A buyer is matched to a capability only if it satisfies that policy.</p>
        {steward && !form && <button className="btn" onClick={() => { setForm(true); setPolicy([]); }}>Register a capability</button>}
      </div>
      <Explainer help={TAB_HELP.capabilities} />

      {form && (
        <Panel title="Register a capability">
          <div className="form">
            <label>Name<input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Precision CNC Manufacturing" /></label>
            <label>Capability
              <input className="field" list="caps" value={f.capability} onChange={(e) => setF({ ...f, capability: e.target.value })} />
              <datalist id="caps">{CAPABILITIES.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label>What the contract gives access to
              <select className="field" value={f.resourceKind} onChange={(e) => setF({ ...f, resourceKind: e.target.value })}>
                {KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
            <label>Resource name<input className="field" value={f.resource} onChange={(e) => setF({ ...f, resource: e.target.value })} placeholder="Real-time machine availability API" /></label>
            <label>Capacity (machine hours per month)<input className="field" type="number" min="0" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></label>
            <label>Asset on your connector
              <select className="field" value={f.assetId} onChange={(e) => setF({ ...f, assetId: e.target.value })}>
                <option value="">none (cannot be contracted for data)</option>
                {(ownAssets.data ?? []).filter((a) => !taken.has(a.assetId)).map((a) => <option key={a.assetId} value={a.assetId}>{a.title}</option>)}
              </select>
            </label>
            <label className="span2">Keywords (comma separated)<input className="field" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="5-axis, milling, titanium" /></label>
            <label className="span2">Description<input className="field" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <div className="span2"><PolicyBuilder ctx={ctx} value={policy} onChange={setPolicy} companies={companies.data ?? []} /></div>
            <div className="form-actions span2">
              <button className="btn" disabled={busy || !f.name.trim()} onClick={create}>Register</button>
              <button className="btn ghost" onClick={() => setForm(false)}>Cancel</button>
            </div>
          </div>
        </Panel>
      )}

      <Status loading={offerings.loading} error={offerings.error} empty={(offerings.data ?? []).length === 0} emptyText="No capability has been published yet.">
        <div className="stories">
          {(offerings.data ?? []).map((o) => {
            const mine = steward && o.providerBpn === session.bpn;
            return (
              <OfferingCard key={o.id} o={o}>
                {mine && edit !== o.id && (
                  <div className="row">
                    {!o.published && <button className="btn sm" disabled={busy} onClick={() => run(() => api.publishOffering(o.id), `${o.name} published: its policy is on your connector and at the policy decision points`)}>Publish</button>}
                    <button className="btn ghost sm" onClick={() => { setEdit(o.id); setPolicy(rowsOf(o)); }}>Change the policy</button>
                  </div>
                )}
                {edit === o.id && (
                  <>
                    <PolicyBuilder ctx={ctx} value={policy} onChange={setPolicy} companies={companies.data ?? []} />
                    <div className="row">
                      <button className="btn sm" disabled={busy} onClick={() => run(() => api.setOfferingPolicy(o.id, policy), "Policy changed. Contracts already made keep the policy they were agreed under.")}>Save the policy</button>
                      <button className="btn ghost sm" onClick={() => setEdit(null)}>Discard</button>
                    </div>
                  </>
                )}
              </OfferingCard>
            );
          })}
        </div>
      </Status>
    </>
  );
}

/* ------------------------------------------------------------ Service RFQs */

export function ServiceRfqs({ ctx, rfqId }: { ctx: Ctx; rfqId?: string }) {
  return rfqId ? <ServiceMatches ctx={ctx} rfqId={rfqId} /> : <ServiceRfqList ctx={ctx} />;
}

const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

function ServiceRfqList({ ctx }: { ctx: Ctx }) {
  const { api, session } = ctx;
  const toast = useToast();
  const rfqs = useAsync(() => api.rfqs(), [api]);
  const companies = useAsync(() => api.participants(), [api]);
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: "", story: "", capability: CAPABILITIES[0], keywords: "", capacity: "", region: "", startDate: plusDays(0), endDate: plusDays(60), purpose: PURPOSES[0] });
  const rows = (rfqs.data ?? []).filter((r) => r.capability);
  const name = (bpn: string) => companies.data?.find((p) => p.bpn === bpn)?.shortName ?? bpn;
  const sees = (r: Rfq) => ctx.operator || r.buyerBpn === session.bpn;

  async function post() {
    setBusy(true);
    try {
      const r = await api.createServiceRfq({
        title: f.title, story: f.story, capability: f.capability, keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean),
        requiredCapacity: f.capacity ? Number(f.capacity) : null, preferredRegion: f.region, startDate: f.startDate, endDate: f.endDate, purpose: f.purpose,
      });
      go("service", r.id);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="view-head">
        <h1>Service RFQs</h1>
        <p className="muted">Ask for a manufacturing capability. REED first finds the offerings that fit technically, then asks Open Policy Agent whether your organisation satisfies each provider's policy.</p>
        {session.has("buyer") && !form && <button className="btn" onClick={() => setForm(true)}>Request a capability</button>}
      </div>
      <Explainer help={TAB_HELP.service} />
      {form && (
        <Panel title="Request for quotation: a manufacturing capability">
          <div className="form">
            <label className="span2">Title<input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Pilot batch: precision housings" /></label>
            <label>Requested capability
              <input className="field" list="caps-rfq" value={f.capability} onChange={(e) => setF({ ...f, capability: e.target.value })} />
              <datalist id="caps-rfq">{CAPABILITIES.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label>Technical requirements (keywords)<input className="field" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="5-axis, titanium" /></label>
            <label>Required capacity (hours per month)<input className="field" type="number" min="0" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></label>
            <label>Preferred region
              <select className="field" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
                <option value="">Anywhere</option><option value="EEA">EU/EEA</option><option value="EU">EU</option><option value="NORDIC">Nordic countries</option>
              </select>
            </label>
            <label>Start<input className="field" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
            <label>End<input className="field" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
            <label>Purpose of use
              <select className="field" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>
                {PURPOSES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="span2">Project information (organisation and project data only)<input className="field" value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} /></label>
            <div className="form-actions span2">
              <button className="btn" disabled={busy || !f.title.trim()} onClick={post}>Post and match</button>
              <button className="btn ghost" onClick={() => setForm(false)}>Cancel</button>
            </div>
          </div>
        </Panel>
      )}
      <Panel title="Service requests">
        <Status loading={rfqs.loading} error={rfqs.error} empty={rows.length === 0} emptyText="No service RFQ has been posted yet.">
          <table className="grid">
            <thead><tr><th>RFQ</th><th>Buyer</th><th>Capability</th><th>Requirements</th><th>Period</th><th>Purpose</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={sees(r) ? "clickable" : ""} onClick={sees(r) ? () => go("service", r.id) : undefined}>
                  <td><div className="asset-name">{sees(r) ? <a href={`#/service/${r.id}`}>{r.title}</a> : r.title}</div><div className="asset-id">{r.id}</div></td>
                  <td>{name(r.buyerBpn)}</td>
                  <td className="mono">{r.capability}</td>
                  <td className="faint">{[...(r.keywords ?? []), r.requiredCapacity ? `${r.requiredCapacity} h/month` : "", r.preferredRegion ?? ""].filter(Boolean).join(", ")}</td>
                  <td className="mono">{r.startDate} – {r.endDate}</td>
                  <td>{r.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Status>
      </Panel>
    </>
  );
}

/** Capability match | policy eligibility | final answer, per offering. */
export function MatchList({ matches, action }: { matches: ServiceMatch[]; action?: (m: ServiceMatch) => ReactNode }) {
  return (
    <div className="stack">
      {matches.map((m) => (
        <article key={m.offering.id} className={`match3 ${m.eligible ? "eligible" : ""}`} data-offering={m.offering.id}>
          <header>
            <span className="org-flag">{m.offering.providerCountry}</span>
            <h3>{m.offering.name}</h3>
            <span className="faint">{m.offering.provider}{m.offering.resource ? ` · ${m.offering.resource}` : ""}</span>
          </header>
          <div className="match3-cols">
            <section>
              <h4>1 · Capability match <Verdict decision={String(m.capabilityMatch)} small /></h4>
              <Conditions list={m.capabilityChecks} />
            </section>
            <section>
              <h4>2 · Policy eligibility {m.policy ? <Verdict decision={String(m.policyEligible)} small /> : <span className="faint">not asked</span>}</h4>
              {m.policy ? <Conditions list={m.policy.conditions} />
                : <p className="muted">The capability does not match, so the provider's policy was not evaluated.</p>}
              {m.policy && <div className="asset-id">decided by Open Policy Agent at {m.policy.decidedBy}</div>}
            </section>
            <section className="match3-final">
              <h4>3 · Final</h4>
              <Verdict decision={m.eligible ? "ALLOW" : "DENY"} />
              <p>{m.eligible ? "Eligible: you can select this provider."
                : !m.capabilityMatch ? "Not a match: the capability does not fit."
                  : `Not eligible: ${m.policy?.failed.map((f) => f.label).join("; ")}.`}</p>
              {action?.(m)}
            </section>
          </div>
        </article>
      ))}
    </div>
  );
}

function ServiceMatches({ ctx, rfqId }: { ctx: Ctx; rfqId: string }) {
  const { api, session } = ctx;
  const toast = useToast();
  const rfq = useAsync(() => api.rfq(rfqId), [api, rfqId]);
  const matches = useAsync(() => api.serviceMatches(rfqId), [api, rfqId]);
  const [busy, setBusy] = useState(false);
  const mine = rfq.data?.buyerBpn === session.bpn && session.has("buyer");

  async function select(m: ServiceMatch) {
    setBusy(true);
    try {
      const c = await api.selectProvider(rfqId, m.offering.id);
      go("agreements", c.id);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="view-head">
        <h1>{rfq.data?.title ?? "Service RFQ"}</h1>
        <p className="muted">Each provider is judged twice, separately: does its capability fit the request, and does the buyer satisfy its access policy. Only both together make an eligible match.</p>
      </div>
      {rfq.data && (
        <dl className="wallet">
          <div><dt>Capability</dt><dd className="mono">{rfq.data.capability}</dd></div>
          <div><dt>Requirements</dt><dd>{(rfq.data.keywords ?? []).join(", ") || "none"}</dd></div>
          <div><dt>Capacity</dt><dd>{rfq.data.requiredCapacity ? `${rfq.data.requiredCapacity} h/month` : "any"}</dd></div>
          <div><dt>Region</dt><dd>{rfq.data.preferredRegion ?? "anywhere"}</dd></div>
          <div><dt>Period</dt><dd className="mono">{rfq.data.startDate} – {rfq.data.endDate}</dd></div>
          <div><dt>Purpose</dt><dd>{rfq.data.purpose}</dd></div>
        </dl>
      )}
      <Status loading={matches.loading} error={matches.error} empty={(matches.data ?? []).length === 0} emptyText="No capability is offered yet.">
        <MatchList matches={matches.data ?? []} action={(m) =>
          m.contractId ? <a className="btn ghost sm" href={`#/agreements/${m.contractId}`}>Contract {m.contractId} ({m.contractStatus})</a>
            : m.eligible && mine ? <button className="btn sm" disabled={busy} onClick={() => select(m)}>Select this provider</button> : null} />
      </Status>
    </>
  );
}

/* ------------------------------------------------------------ Service contracts */

export function StatusBadge({ status }: { status: string }) {
  const cls = status === "ACTIVE" ? "confirmed" : status === "DRAFT" ? "proposed" : status === "EXPIRED" || status === "TERMINATED" ? "rejected" : "accepted";
  return <span className={`state state-${cls}`}>{status}</span>;
}

export function ContractTable({ rows }: { rows: Contract[] }) {
  return (
    <table className="grid">
      <thead><tr><th>Contract</th><th>Capability</th><th>Provider</th><th>Consumer</th><th>Period</th><th>Purpose</th><th>Policy at</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="clickable" onClick={() => go("agreements", c.id)}>
            <td><a className="mono" href={`#/agreements/${c.id}`}>{c.id}</a></td>
            <td><div className="asset-name">{c.offering}</div><div className="asset-id">{c.resource} · {c.assetId}</div></td>
            <td>{c.provider}</td>
            <td>{c.consumer}</td>
            <td className="mono">{c.startDate} – {c.expiryDate}</td>
            <td>{c.purpose}</td>
            <td className="mono faint">{c.deployedTo ?? "not deployed"}</td>
            <td><StatusBadge status={c.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ServiceContracts({ ctx, contractId }: { ctx: Ctx; contractId?: string }) {
  const list = useAsync(() => (contractId ? Promise.resolve([]) : ctx.api.contracts()), [ctx.api, contractId]);
  if (contractId) return <ContractDetail ctx={ctx} id={contractId} />;
  return (
    <>
      <div className="view-head">
        <h1>Service contracts</h1>
        <p className="muted">Agreements between a buyer and a provider about a capability. Each carries its effective policy as ODRL and as the Rego that the provider's Open Policy Agent enforces.</p>
      </div>
      <Explainer help={TAB_HELP.agreements} />
      <Panel title={ctx.operator ? "All contracts" : "Your organisation's contracts"}>
        <Status loading={list.loading} error={list.error} empty={(list.data ?? []).length === 0}
                emptyText={<>No contract yet. <a href="#/service">Post a service RFQ and select an eligible provider.</a></>}>
          <ContractTable rows={list.data ?? []} />
        </Status>
      </Panel>
    </>
  );
}

const FLOW = ["Asking for the catalogue", "Negotiating", "Contract agreed", "Starting the transfer", "Transfer started", "Access token issued", "Payload received"];

function ContractDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const { api, session, config } = ctx;
  const toast = useToast();
  const c = useAsync(() => api.contract(id), [api, id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const [simPurpose, setSimPurpose] = useState("");
  const [simDate, setSimDate] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; payload?: any } | null>(null);
  const [sim, setSim] = useState<Outcome | null>(null);
  const k = c.data;
  if (!k) return <Status loading={c.loading} error={c.error} />;

  const buyer = k.consumerBpn === session.bpn && session.has("buyer");
  const party = k.consumerBpn === session.bpn || k.providerBpn === session.bpn;
  const provider = config.connectors.find((x) => x.name === k.providerConnector);
  const declared = purpose || k.purpose;

  async function step(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
      c.reload();
    }
  }
  /** Accept the terms, let the two connectors negotiate, and hand the agreement to REED. */
  const conclude = () => step("Accepting the terms", async () => {
    if (k.status === "DRAFT") await api.contractStep(k.id, "accept");
    if (!provider || !k.consumerConnector) throw new Error("both parties need a connector");
    const agreementId = await agree(api, k.consumerConnector, provider, k.assetId, { onStage: (s) => setBusy(FLOW[s]) });
    await api.contractAgreed(k.id, agreementId);
    toast("ok", `Contract ACTIVE: its policy is deployed to ${k.provider}'s Open Policy Agent`);
  });
  /** A real request through both connectors; the provider's enforcement point asks its Open Policy Agent. */
  const request = () => step("Requesting", async () => {
    setResult(null);
    if (!provider || !k.consumerConnector || !k.agreementId) throw new Error("no agreement to request under");
    try {
      const payload = await pullUnder(api, k.consumerConnector, provider, k.agreementId, { onStage: (s) => setBusy(FLOW[s]) }, declared);
      setResult({ ok: true, text: `ALLOW: ${k.provider}'s connector released ${k.resource ?? k.assetId}`, payload: JSON.parse(payload) });
    } catch (e: any) {
      setResult({ ok: false, text: `Refused by ${k.provider}'s connector: ${e.message}` });
    }
  });
  const simulate = () => step("Simulating", async () => {
    setSim(await api.simulate({ contractId: k.id, purpose: simPurpose || k.purpose, at: simDate ? `${simDate}T12:00:00Z` : undefined }));
  });

  return (
    <>
      <div className="view-head">
        <h1>Contract {k.id} <StatusBadge status={k.status} /></h1>
        <p className="muted">{k.consumer} uses {k.offering} of {k.provider}: {k.resource ?? k.assetId}.</p>
      </div>
      <dl className="wallet">
        <div><dt>Provider</dt><dd>{k.provider}</dd></div>
        <div><dt>Consumer</dt><dd>{k.consumer}</dd></div>
        <div><dt>Capability</dt><dd className="mono">{k.capability}</dd></div>
        <div><dt>Resource</dt><dd className="mono">{k.assetId}</dd></div>
        <div><dt>Period</dt><dd className="mono">{k.startDate} – {k.expiryDate}</dd></div>
        <div><dt>Purpose</dt><dd>{k.purpose}</dd></div>
        <div><dt>EDC agreement</dt><dd className="mono">{k.agreementId ? k.agreementId.slice(0, 13) + "…" : "none yet"}</dd></div>
        <div><dt>Policy enforced at</dt><dd className="mono">{k.deployedTo ?? "not deployed"}</dd></div>
      </dl>

      <Panel title="Policy lifecycle: from the provider's definition to runtime enforcement">
        <LifecycleRail steps={k.lifecycle} />
      </Panel>

      <div className="terms-grid">
        <Panel title="Terms: the effective policy of this contract">
          <PolicyBlock policy={k.policy} />
        </Panel>

        <div className="stack">
          <Panel title="Next step">
            {busy && <div className="notice"><span className="spinner" aria-hidden /> {busy}…</div>}
            {(k.status === "DRAFT" || k.status === "NEGOTIATING") && (buyer
              ? <>
                  <p>{k.status === "DRAFT" ? "Read the terms on the left. Accepting them starts the negotiation between your connector and the provider's." : "Terms accepted. The connectors still have to agree."}</p>
                  <button className="btn" disabled={!!busy} onClick={conclude}>{k.status === "DRAFT" ? "Accept the terms and conclude the contract" : "Negotiate over the connectors"}</button>
                </>
              : <p className="muted">Waiting for {k.consumer}'s buyer to accept the terms.</p>)}
            {k.status === "AGREED" && (
              <>
                <p>The connectors agreed, but the policy has not reached {k.provider}'s Open Policy Agent yet.</p>
                {(party || ctx.operator) && <button className="btn" disabled={!!busy} onClick={() => step("Deploying the policy", () => api.contractStep(k.id, "activate"))}>Deploy the policy</button>}
              </>
            )}
            {k.status === "ACTIVE" && buyer && (
              <>
                <p>Request the data through the connectors. {k.provider}'s enforcement point asks its own Open Policy Agent before anything leaves.</p>
                <div className="row">
                  <label className="row">Declared purpose
                    <select className="field" value={declared} onChange={(e) => setPurpose(e.target.value)} aria-label="Declared purpose">
                      {PURPOSES.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </label>
                  <button className="btn" disabled={!!busy} onClick={request}>Request the data</button>
                </div>
              </>
            )}
            {k.status === "ACTIVE" && !buyer && <p className="muted">The contract is active. Only {k.consumer} can request the data.</p>}
            {(k.status === "EXPIRED" || k.status === "TERMINATED") && <p className="muted">This contract is {k.status.toLowerCase()}: every request under it is denied.</p>}
            {result && (
              <div className={result.ok ? "ok-box" : "error-box"} data-testid="request-result">
                {result.text}
                {result.payload && <details><summary>Payload</summary><Json value={result.payload} /></details>}
              </div>
            )}
            {k.status !== "TERMINATED" && k.status !== "EXPIRED" && (party || ctx.operator) && (ctx.operator || session.has("buyer") || session.has("data-steward")) && (
              <p><button className="btn ghost sm danger" disabled={!!busy} onClick={() => step("Terminating", () => api.contractStep(k.id, "terminate"))}>Terminate the contract</button></p>
            )}
          </Panel>

          {k.deployedTo && (
            <Panel title="Simulated request (what would Open Policy Agent say?)">
              <div className="row">
                <select className="field" value={simPurpose || k.purpose} onChange={(e) => setSimPurpose(e.target.value)} aria-label="Simulated purpose">
                  {PURPOSES.map((p) => <option key={p}>{p}</option>)}
                </select>
                <input className="field" type="date" value={simDate} onChange={(e) => setSimDate(e.target.value)} aria-label="Simulated date (today if empty)" />
                <button className="btn ghost" disabled={!!busy} onClick={simulate}>Ask</button>
              </div>
              {sim && <div className="sim" data-testid="sim-result"><Verdict decision={sim.decision} /> <Conditions list={sim.conditions} /></div>}
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Decisions under this contract">
        <Status loading={false} error={null} empty={k.decisions.length === 0} emptyText="No request has been decided yet.">
          <ul className="decisions">
            {k.decisions.map((d, i) => (
              <li key={d.id ?? i}>
                <div className="row"><Verdict decision={d.decision} small /> <span>{STAGE_TEXT[d.stage]}</span>
                  <span className="mono faint">{when(d.at)} · {d.decidedBy}</span></div>
                <Conditions list={d.decision === "ALLOW" ? d.conditions : d.failed} />
              </li>
            ))}
          </ul>
        </Status>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------ Operator console */

type OpTab = "members" | "connectors" | "capabilities" | "rfqs" | "contracts" | "decisions";
const OP_TABS: [OpTab, string][] = [["members", "Members"], ["connectors", "Connectors"], ["capabilities", "Capabilities & policies"],
  ["rfqs", "RFQs & matches"], ["contracts", "Contracts"], ["decisions", "Policy decisions"]];

export function Operator({ ctx }: { ctx: Ctx }) {
  const [tab, setTab] = useState<OpTab>("members");
  return (
    <>
      <div className="view-head">
        <h1>Data space operator</h1>
        <p className="muted">REED as control plane: who is in the consortium, which connectors are registered, and how each policy moved from a provider's definition to a decision at a connector. Data never passes through here.</p>
      </div>
      <Explainer help={TAB_HELP.operator} />
      <div className="controls">
        <div className="seg" role="tablist" aria-label="Operator sections">
          {OP_TABS.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{label}</button>)}
        </div>
      </div>
      {tab === "members" && <OpMembers ctx={ctx} />}
      {tab === "connectors" && <OpConnectors ctx={ctx} />}
      {tab === "capabilities" && <OpCapabilities ctx={ctx} />}
      {tab === "rfqs" && <OpRfqs ctx={ctx} />}
      {tab === "contracts" && <OpContracts ctx={ctx} />}
      {tab === "decisions" && <OpDecisions ctx={ctx} />}
    </>
  );
}

function OpMembers({ ctx }: { ctx: Ctx }) {
  const { api } = ctx;
  const toast = useToast();
  const members = useAsync(() => api.participants(), [api]);
  const [form, setForm] = useState(false);
  const [f, setF] = useState({ name: "", shortName: "", role: "OEM", country: "", city: "", industry: "", classes: "" });
  const [classes, setClasses] = useState<Record<string, string>>({});
  const admin = ctx.session.has("admin");
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast("ok", done);
      members.reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  return (
    <Panel title="Consortium members" right={admin && !form && <button className="btn sm" onClick={() => setForm(true)}>Onboard a company</button>}>
      {form && (
        <div className="form onboard">
          <label>Company name<input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Short name<input className="field" value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} /></label>
          <label>Organisation type
            <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>OEM</option><option>SUPPLIER</option><option>SERVICE</option></select>
          </label>
          <label>Country (two letters)<input className="field" maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} /></label>
          <label>City<input className="field" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
          <label>Industry<input className="field" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} placeholder="machining" /></label>
          <label className="span2">Competitor classes (market segments, comma separated)<input className="field" value={f.classes} onChange={(e) => setF({ ...f, classes: e.target.value })} placeholder="precision-machining" /></label>
          <p className="note span2">Registers the company as PENDING. Its connector, identity and policy decision point are deployment containers: add them in the roster and run the topology generator. Fictional companies only.</p>
          <div className="form-actions span2">
            <button className="btn" disabled={!f.name.trim() || f.country.length !== 2}
                    onClick={() => act(async () => { await api.onboard({ ...f, competitorClasses: list(f.classes) }); setForm(false); }, `${f.name} registered: PENDING`)}>Register</button>
            <button className="btn ghost" onClick={() => setForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      <Status loading={members.loading} error={members.error}>
        <table className="grid">
          <thead><tr><th>Company</th><th>Type</th><th>Country</th><th>Industry</th><th>Competitor classes</th><th>Connector</th><th>Membership</th>{admin && <th />}</tr></thead>
          <tbody>
            {(members.data ?? []).map((p) => (
              <tr key={p.bpn} data-bpn={p.bpn}>
                <td><div className="asset-name">{p.name}</div><div className="asset-id">{p.bpn}{p.verified ? " · verified" : " · not verified"}{p.illustrative ? " · illustrative" : ""}</div></td>
                <td>{p.role}</td>
                <td>{p.country} <span className="faint">{EEA.includes(p.country) ? "EU/EEA" : "outside EEA"}</span></td>
                <td>{p.industry ?? "—"}</td>
                <td>
                  {admin
                    ? <span className="row">
                        <input className="field" aria-label={`Competitor classes of ${p.shortName}`} value={classes[p.bpn] ?? p.competitorClasses.join(", ")}
                               onChange={(e) => setClasses({ ...classes, [p.bpn]: e.target.value })} />
                        {classes[p.bpn] !== undefined && classes[p.bpn] !== p.competitorClasses.join(", ") && (
                          <button className="btn ghost sm" onClick={() => act(() => api.updateCompany(p.bpn, { competitorClasses: list(classes[p.bpn]) }), `Competitor classes of ${p.shortName} updated`)}>Save</button>
                        )}
                      </span>
                    : p.competitorClasses.join(", ") || "—"}
                </td>
                <td className="mono">{p.connectorName ?? <span className="faint">none</span>}</td>
                <td><span className={`state state-${p.membershipStatus === "ACTIVE" ? "confirmed" : p.membershipStatus === "PENDING" ? "accepted" : "rejected"}`}>{p.membershipStatus}</span></td>
                {admin && (
                  <td className="right">
                    {p.membershipStatus !== "ACTIVE" && <button className="btn ghost sm" onClick={() => act(() => api.setMembership(p.bpn, "ACTIVE"), `${p.shortName} is an active member`)}>{p.membershipStatus === "PENDING" ? "Approve" : "Reactivate"}</button>}
                    {p.membershipStatus === "ACTIVE" && <button className="btn ghost sm danger" onClick={() => act(() => api.setMembership(p.bpn, "SUSPENDED"), `${p.shortName} suspended`)}>Suspend</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Status>
    </Panel>
  );
}

function OpConnectors({ ctx }: { ctx: Ctx }) {
  const rows = useAsync(() => ctx.api.connectorStatus(), [ctx.api]);
  return (
    <Panel title="Registered connectors and their policy decision points" right={<button className="btn ghost sm" onClick={rows.reload}>Refresh</button>}>
      <Status loading={rows.loading} error={rows.error}>
        <table className="grid">
          <thead><tr><th>Company</th><th>Connector</th><th>Endpoint (DSP)</th><th>Connector</th><th>Open Policy Agent</th><th>Status</th></tr></thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={r.connector}>
                <td><div className="asset-name">{r.company}</div><div className="asset-id">{decodeURIComponent(r.did)}</div></td>
                <td className="mono">{r.connector}</td>
                <td className="mono faint">{r.endpoint}</td>
                <td><Led online={r.online} label={r.online ? "online" : "offline"} /></td>
                <td className="mono faint">{r.decisionPoint}</td>
                <td><Led online={r.decisionPointOnline} label={r.decisionPointOnline ? "online" : "offline"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Status>
    </Panel>
  );
}

function OpCapabilities({ ctx }: { ctx: Ctx }) {
  const { api } = ctx;
  const offerings = useAsync(() => api.offerings(), [api]);
  const companies = useAsync(() => api.participants(), [api]);
  const [who, setWho] = useState<Record<string, string>>({});
  const [out, setOut] = useState<Record<string, Outcome>>({});
  const toast = useToast();
  return (
    <Status loading={offerings.loading} error={offerings.error} empty={(offerings.data ?? []).length === 0} emptyText="No capability registered.">
      <div className="stories">
        {(offerings.data ?? []).map((o) => (
          <OfferingCard key={o.id} o={o}>
            <div className="field-label">Would this company be eligible? (asks REED's Open Policy Agent)</div>
            <div className="row">
              <select className="field" aria-label={`Company to check against ${o.name}`} value={who[o.id] ?? ""} onChange={(e) => setWho({ ...who, [o.id]: e.target.value })}>
                <option value="">company…</option>
                {(companies.data ?? []).filter((c) => c.bpn !== o.providerBpn).map((c) => <option key={c.bpn} value={c.bpn}>{c.shortName} ({c.membershipStatus})</option>)}
              </select>
              <button className="btn ghost sm" disabled={!who[o.id]}
                      onClick={() => api.simulate({ offeringId: o.id, requesterBpn: who[o.id], purpose: "pilot-evaluation" })
                        .then((r) => setOut({ ...out, [o.id]: r })).catch((e) => toast("error", e.message))}>Check</button>
            </div>
            {out[o.id] && <div className="sim"><Verdict decision={out[o.id].decision} small /> <Conditions list={out[o.id].conditions} /></div>}
          </OfferingCard>
        ))}
      </div>
    </Status>
  );
}

function OpRfqs({ ctx }: { ctx: Ctx }) {
  const { api } = ctx;
  const rfqs = useAsync(() => api.rfqs(), [api]);
  const companies = useAsync(() => api.participants(), [api]);
  const [open, setOpen] = useState<string | null>(null);
  const matches = useAsync(() => (open ? api.serviceMatches(open) : Promise.resolve([])), [api, open]);
  const rows = (rfqs.data ?? []).filter((r) => r.capability);
  const name = (bpn: string) => companies.data?.find((p) => p.bpn === bpn)?.shortName ?? bpn;
  return (
    <Panel title="Service RFQs and their policy-aware matches">
      <Status loading={rfqs.loading} error={rfqs.error} empty={rows.length === 0} emptyText="No service RFQ yet.">
        <div className="stack">
          {rows.map((r) => (
            <div key={r.id}>
              <button className="link" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? "▾" : "▸"} {r.title} · {name(r.buyerBpn)} · {r.capability} · purpose {r.purpose}
              </button>
              {open === r.id && <Status loading={matches.loading} error={matches.error}><MatchList matches={matches.data ?? []}
                action={(m) => m.contractId ? <a className="btn ghost sm" href={`#/agreements/${m.contractId}`}>Contract {m.contractId} ({m.contractStatus})</a> : null} /></Status>}
            </div>
          ))}
        </div>
      </Status>
    </Panel>
  );
}

function OpContracts({ ctx }: { ctx: Ctx }) {
  const rows = useAsync(() => ctx.api.contracts(), [ctx.api]);
  return (
    <Panel title="Contracts and where their policy is enforced">
      <Status loading={rows.loading} error={rows.error} empty={(rows.data ?? []).length === 0} emptyText="No contract yet.">
        <ContractTable rows={rows.data ?? []} />
        <p className="note">Open a contract for its policy lifecycle, the ODRL policy, the generated Rego and the decisions taken under it.</p>
      </Status>
    </Panel>
  );
}

export function OpDecisions({ ctx }: { ctx: Ctx }) {
  const rows = useAsync(() => ctx.api.decisions(), [ctx.api]);
  return (
    <Panel title="Open Policy Agent decisions (newest first; select a row for every condition)" right={<button className="btn ghost sm" onClick={rows.reload}>Refresh</button>}>
      <Status loading={rows.loading} error={rows.error} empty={(rows.data ?? []).length === 0} emptyText="No decision yet.">
        <DecisionTable rows={rows.data ?? []} />
      </Status>
    </Panel>
  );
}
