import { useMemo, useState } from "react";
import type { Ctx } from "../App";
import { go } from "../App";
import type { DraftResponse, Rfq } from "../api";
import { Panel, StateBadge, Status, fmtDims, fmtMass, useAsync, useToast } from "../ui";
import { Explainer, TAB_HELP } from "../guide";

const SECTORS = [
  ["wind", "Wind energy"], ["offshore", "Shipbuilding & offshore"], ["rail", "Rail"],
  ["heavy-machinery", "Heavy machinery"], ["hydro", "Hydropower"],
] as const;

export function Marketplace({ ctx }: { ctx: Ctx }) {
  const { api, session } = ctx;
  const rfqs = useAsync(() => api.rfqs(), [api]);
  const parts = useAsync(() => api.participants(), [api]);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"open" | "all" | "mine">("open");
  const name = (bpn: string) => parts.data?.find((p) => p.bpn === bpn)?.shortName ?? bpn;
  const canRank = session.has("buyer") || session.has("quality-auditor") || ctx.operator;

  const rows = (rfqs.data ?? []).filter((r) =>
    filter === "all" ? true : filter === "mine" ? r.buyerBpn === session.bpn : r.state === "OPEN");

  return (
    <>
      <div className="view-head">
        <h1>Marketplace</h1>
        <p className="muted">What OEMs across the data space need made. Post an RFQ and REED ranks qualified suppliers straight away.</p>
        {session.has("buyer") && !showForm && <button className="btn" onClick={() => setShowForm(true)}>Post an RFQ</button>}
      </div>
      <Explainer help={TAB_HELP.marketplace} />

      {showForm && (
        <RfqForm ctx={ctx} onCancel={() => setShowForm(false)}
                 onCreated={(r) => { setShowForm(false); rfqs.reload(); go("matches", r.id); }} />
      )}

      <Panel title="Requests for quotation" right={
        <div className="seg" role="group" aria-label="Filter RFQs">
          {(["open", "mine", "all"] as const).filter((f) => f !== "mine" || session.has("buyer")).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "open" ? "Open" : f === "mine" ? "Posted by us" : "All"}
            </button>
          ))}
        </div>}>
        <Status loading={rfqs.loading} error={rfqs.error} empty={rows.length === 0}
                emptyText={filter === "mine" ? "You have not posted an RFQ yet." : "No RFQs match this filter."}>
          <table className="grid">
            <thead>
              <tr><th>RFQ</th><th>Buyer</th><th>Part</th><th className="right">Mass</th><th>Requires</th><th>Due</th><th>State</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={canRank ? "clickable" : ""} onClick={canRank ? () => go("matches", r.id) : undefined}>
                  <td>
                    <div className="asset-name">{canRank ? <a href={`#/matches/${r.id}`}>{r.title}</a> : r.title}</div>
                    <div className="asset-id">{r.id} · {SECTORS.find((s) => s[0] === r.sector)?.[1] ?? r.sector}</div>
                  </td>
                  <td>{name(r.buyerBpn)}</td>
                  <td><div>{r.material ?? "any material"}</div><div className="faint mono">{fmtDims(r.dimsMm)} · ×{r.quantity}</div></td>
                  <td className="right mono">{fmtMass(r.massKg)}</td>
                  <td className="faint">{[...r.requiredProcesses, ...r.requiredCerts].join(", ")}</td>
                  <td className="mono">{r.dueDate}</td>
                  <td><StateBadge state={r.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Status>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- RFQ form */
interface FormState {
  title: string; story: string; sector: string; partFamily: string; material: string;
  l: string; w: string; h: string; massT: string; tolMm: string; quantity: string; dueDate: string;
  requiredProcesses: string[]; requiredCerts: string[]; partnerProcesses: string[];
}

const EMPTY: FormState = {
  title: "", story: "", sector: "wind", partFamily: "", material: "", l: "", w: "", h: "", massT: "", tolMm: "",
  quantity: "1", dueDate: "", requiredProcesses: [], requiredCerts: [], partnerProcesses: [],
};

function RfqForm({ ctx, onCancel, onCreated }: { ctx: Ctx; onCancel: () => void; onCreated: (r: Rfq) => void }) {
  const { api } = ctx;
  const toast = useToast();
  const parts = useAsync(() => api.participants(), [api]);
  const vocab = useMemo(() => {
    const materials = new Set<string>(), processes = new Set<string>(), certs = new Set<string>();
    (parts.data ?? []).forEach((p) => {
      p.verifiedCerts.forEach((c) => certs.add(c));
      p.capability?.materials.forEach((m) => materials.add(m));
      p.capability?.processes.forEach((m) => processes.add(m));
    });
    return { materials: [...materials].sort(), processes: [...processes].sort(), certs: [...certs].sort() };
  }, [parts.data]);

  const [f, setF] = useState<FormState>(EMPTY);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const set = (k: keyof FormState, v: any) => setF((s) => ({ ...s, [k]: v }));
  const toggle = (k: "requiredProcesses" | "requiredCerts" | "partnerProcesses", v: string) =>
    setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  async function runDraft() {
    setDrafting(true);
    try {
      const d = await api.draftRfq(text);
      setDraft(d);
      const x = d.draft;
      const due = x.dueInWeeks ? new Date(Date.now() + x.dueInWeeks * 7 * 864e5).toISOString().slice(0, 10) : "";
      setF({
        title: x.title ?? "", story: d.redactedText, sector: x.sector ?? "wind", partFamily: x.partFamily ?? "",
        material: x.material ?? "", l: m(x.dimsMm?.[0]), w: m(x.dimsMm?.[1]), h: m(x.dimsMm?.[2]),
        massT: x.massKg ? String(x.massKg / 1000) : "", tolMm: x.tolMm ? String(x.tolMm) : "",
        quantity: String(x.quantity ?? 1), dueDate: due,
        requiredProcesses: x.requiredProcesses, requiredCerts: x.requiredCerts, partnerProcesses: x.partnerProcesses,
      });
    } catch (e: any) {
      toast("error", `Could not draft the RFQ: ${e.message}`);
    } finally {
      setDrafting(false);
    }
  }

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!f.title.trim()) errors.title = "Give the RFQ a title.";
  for (const k of ["l", "w", "h"] as const) if (!(Number(f[k]) > 0)) errors[k] = "Enter a size in metres.";
  if (!(Number(f.massT) > 0)) errors.massT = "Enter the mass in tonnes.";
  if (f.tolMm && !(Number(f.tolMm) > 0)) errors.tolMm = "Tolerance must be positive.";
  if (!f.dueDate || new Date(f.dueDate) <= new Date()) errors.dueDate = "Pick a date in the future.";
  if (f.requiredProcesses.length === 0) errors.requiredProcesses = "Pick at least one process.";
  const valid = Object.keys(errors).length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    try {
      const r = await api.createRfq({
        title: f.title, story: f.story || null, sector: f.sector, partFamily: f.partFamily || null,
        material: f.material || null, dimsMm: [f.l, f.w, f.h].map((x) => Math.round(Number(x) * 1000)),
        massKg: Number(f.massT) * 1000, tolMm: f.tolMm ? Number(f.tolMm) : null, quantity: Number(f.quantity) || 1,
        dueDate: f.dueDate, requiredProcesses: f.requiredProcesses, requiredCerts: f.requiredCerts,
        partnerProcesses: f.partnerProcesses,
      });
      toast("ok", `RFQ ${r.id} posted - suppliers ranked`);
      onCreated(r);
    } catch (e: any) {
      toast("error", `RFQ not posted: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const err = (k: keyof FormState) => touched && errors[k] ? <span className="field-error">{errors[k]}</span> : null;

  return (
    <Panel title="New request for quotation">
      <div className="draft-box">
        <label htmlFor="need">Describe the part in your own words (optional)</label>
        <textarea id="need" className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. 12 ductile iron rotor hubs, 4.2 x 4.0 x 3.6 m, 38 t each, DNV approval, within 40 weeks, plus ultrasonic testing and heavy-lift transport" />
        <div className="row">
          <button type="button" className="btn ghost" disabled={!text.trim() || drafting} onClick={runDraft}>
            {drafting ? "Drafting with the local model…" : "Fill the form from this text"}
          </button>
          {draft && (
            <span className="muted">
              Drafted by {draft.source === "llm" ? "Qwen3.8 (local)" : "rule-based parser - the model was unavailable"}
              {draft.redactions > 0 && ` · ${draft.redactions} personal detail${draft.redactions > 1 ? "s" : ""} removed before sending`}
              {draft.missing.length > 0 && ` · still missing: ${draft.missing.join(", ")}`}. Check every field before posting.
            </span>
          )}
        </div>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        <label className="span2">Title<input className="field" value={f.title} onChange={(e) => set("title", e.target.value)} />{err("title")}</label>
        <label>Sector
          <select className="field" value={f.sector} onChange={(e) => set("sector", e.target.value)}>
            {SECTORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Part family<input className="field" value={f.partFamily} onChange={(e) => set("partFamily", e.target.value)} placeholder="hub, ring, node…" /></label>
        <label>Material
          <input className="field" list="materials" value={f.material} onChange={(e) => set("material", e.target.value)} placeholder="EN designation" />
          <datalist id="materials">{vocab.materials.map((x) => <option key={x} value={x} />)}</datalist>
        </label>
        <fieldset className="dims">
          <legend>Size (m)</legend>
          <input className="field" aria-label="Length in metres" inputMode="decimal" value={f.l} onChange={(e) => set("l", e.target.value)} placeholder="L" />
          <input className="field" aria-label="Width in metres" inputMode="decimal" value={f.w} onChange={(e) => set("w", e.target.value)} placeholder="W" />
          <input className="field" aria-label="Height in metres" inputMode="decimal" value={f.h} onChange={(e) => set("h", e.target.value)} placeholder="H" />
          {err("l") || err("w") || err("h")}
        </fieldset>
        <label>Mass per part (t)<input className="field" inputMode="decimal" value={f.massT} onChange={(e) => set("massT", e.target.value)} />{err("massT")}</label>
        <label>Tolerance (± mm, optional)<input className="field" inputMode="decimal" value={f.tolMm} onChange={(e) => set("tolMm", e.target.value)} />{err("tolMm")}</label>
        <label>Quantity<input className="field" inputMode="numeric" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></label>
        <label>Needed by<input className="field" type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />{err("dueDate")}</label>

        <ChipPicker label="Processes the supplier must perform" options={vocab.processes} value={f.requiredProcesses}
                    onToggle={(v) => toggle("requiredProcesses", v)} error={touched ? errors.requiredProcesses : undefined} />
        <ChipPicker label="Required certifications (must be verified credentials)" options={vocab.certs} value={f.requiredCerts}
                    onToggle={(v) => toggle("requiredCerts", v)} />
        <ChipPicker label="Steps you want partner recommendations for" options={vocab.processes} value={f.partnerProcesses}
                    onToggle={(v) => toggle("partnerProcesses", v)} />

        <div className="form-actions span2">
          <button className="btn" type="submit" disabled={saving}>{saving ? "Posting…" : "Post RFQ and rank suppliers"}</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
          {touched && !valid && <span className="field-error">Fix the highlighted fields first.</span>}
        </div>
      </form>
    </Panel>
  );
}

function ChipPicker({ label, options, value, onToggle, error }: {
  label: string; options: string[]; value: string[]; onToggle: (v: string) => void; error?: string;
}) {
  return (
    <fieldset className="span2 chip-picker">
      <legend>{label}</legend>
      {options.map((o) => (
        <button type="button" key={o} className={`pick ${value.includes(o) ? "on" : ""}`} aria-pressed={value.includes(o)} onClick={() => onToggle(o)}>
          {o}
        </button>
      ))}
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}

function m(mm?: number | null) {
  return mm ? String(mm / 1000) : "";
}
