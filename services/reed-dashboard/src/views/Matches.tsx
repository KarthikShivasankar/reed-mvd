import { useState } from "react";
import type { Ctx } from "../App";
import { Explanation, RankedSupplier, Rfq, runReedFlow } from "../api";
import {
  BreakdownTable, CertChips, CriterionLegend, Json, Panel, RejectionList, ScoreBars, StateBadge, Status,
  fmtDims, fmtMass, useAsync, useToast,
} from "../ui";
import { StepId, Topology } from "../diagram";
import { Explainer, TAB_HELP } from "../guide";

export function Matches({ ctx, rfqId }: { ctx: Ctx; rfqId?: string }) {
  if (!rfqId) return <RfqPicker ctx={ctx} />;
  return <RfqMatches ctx={ctx} rfqId={rfqId} />;
}

/** Without an RFQ in the URL: the RFQs whose ranking this user may see. */
function RfqPicker({ ctx }: { ctx: Ctx }) {
  const rfqs = useAsync(() => ctx.api.rfqs(), [ctx.api]);
  const mine = (rfqs.data ?? []).filter((r) => ctx.operator || r.buyerBpn === ctx.session.bpn);
  return (
    <>
      <div className="view-head">
        <h1>Matches</h1>
        <p className="muted">Pick one of {ctx.operator ? "the" : "your organisation's"} RFQs to see its ranked suppliers.</p>
      </div>
      <Panel>
        <Status loading={rfqs.loading} error={rfqs.error} empty={mine.length === 0}
                emptyText={<>No RFQs yet. <a href="#/marketplace">Post one in the marketplace.</a></>}>
          <div className="picker">
            {mine.map((r) => (
              <a key={r.id} className="picker-item" href={`#/matches/${r.id}`}>
                <span className="scenario-id">{r.id}</span>
                <span>{r.title}</span>
                <StateBadge state={r.state} />
              </a>
            ))}
          </div>
        </Status>
      </Panel>
    </>
  );
}

const STAGE_TO_STEP: (StepId | null)[] = ["discover", "negotiate", "negotiate", "transfer", "edr", "edr", "pull"];

function RfqMatches({ ctx, rfqId }: { ctx: Ctx; rfqId: string }) {
  const { api, session, config } = ctx;
  const toast = useToast();
  const rfq = useAsync(() => api.rfq(rfqId), [api, rfqId]);
  const ranked = useAsync(() => api.matches(rfqId), [api, rfqId]);
  const partners = useAsync(() => api.partners(rfqId), [api, rfqId]);
  const parts = useAsync(() => api.participants(), [api]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [explain, setExplain] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [flow, setFlow] = useState<{ supplier: RankedSupplier; stage: number; log: string[]; payload?: string; error?: string } | null>(null);

  const isBuyer = !!rfq.data && rfq.data.buyerBpn === session.bpn && session.has("buyer");
  const myConnector = session.participant;
  const buyerName = parts.data?.find((p) => p.bpn === rfq.data?.buyerBpn)?.name ?? rfq.data?.buyerBpn;
  const qualified = (ranked.data ?? []).filter((r) => r.result.qualified);
  const rejected = (ranked.data ?? []).filter((r) => !r.result.qualified);
  // Near misses (they offer the processes but fail on size, material, certification...) are the
  // interesting rejections; companies in another trade are folded away.
  const offTrade = (r: RankedSupplier) => r.result.rejections.some((x) => x.code === "PROCESS_MISSING");
  const nearMisses = rejected.filter((r) => !offTrade(r)).sort((a, b) => a.result.rejections.length - b.result.rejections.length);
  const otherTrades = rejected.filter(offTrade);
  const seesAll = isBuyerOrg(ctx, rfq.data) || ctx.operator;

  async function act(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    try {
      await fn();
      toast("ok", ok);
      ranked.reload();
      rfq.reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
    }
  }

  /** Contract for the supplier's confidential capability over EDC, pull it, then let REED confirm. */
  async function requestDetail(s: RankedSupplier) {
    const provider = config.connectors.find((c) => c.name === s.connectorName);
    if (!provider || !myConnector || !s.detailAssetId || s.matchId == null) return;
    setFlow({ supplier: s, stage: 0, log: [] });
    const add = (m: string) => setFlow((f) => f && { ...f, log: [...f.log, m] });
    try {
      const res = await runReedFlow(api, myConnector, provider, s.detailAssetId, {
        onStage: (stage) => setFlow((f) => f && { ...f, stage }),
        onLog: add,
      });
      setFlow((f) => f && { ...f, payload: res.payload });
      add("REED checks the agreement on your connector and compares the confidential figures with the RFQ");
      const m = await api.confirm(s.matchId, res.agreementId);
      add(m.state === "CONFIRMED" ? `Match confirmed: ${m.note}` : `Match rejected: ${m.note}`);
      toast(m.state === "CONFIRMED" ? "ok" : "error", m.state === "CONFIRMED" ? `${s.result.name} confirmed` : `${s.result.name}: ${m.note}`);
      ranked.reload();
      rfq.reload();
    } catch (e: any) {
      setFlow((f) => f && { ...f, error: e.message });
      toast("error", e.message);
    }
  }

  async function runExplain() {
    setExplaining(true);
    try {
      setExplain(await api.explain(rfqId));
    } catch (e: any) {
      toast("error", `No explanation: ${e.message}`);
    } finally {
      setExplaining(false);
    }
  }

  return (
    <>
      <div className="view-head">
        <a className="back" href="#/marketplace">Marketplace</a>
        <h1>{rfq.data?.title ?? rfqId}</h1>
        {rfq.data && <p className="muted">{rfqId} · posted by {buyerName} · <StateBadge state={rfq.data.state} /></p>}
      </div>
      <Explainer help={TAB_HELP.matches} />

      <Status loading={rfq.loading} error={rfq.error}>
        {rfq.data && <RfqSpec rfq={rfq.data} />}
      </Status>
      {rfq.data && !seesAll && (
        <div className="notice">
          Only {buyerName} sees the full ranking of this RFQ. You see your own organisation's row, if it qualifies -
          suppliers find their scores under <a href="#/opportunities">Opportunities</a>.
        </div>
      )}

      <Panel title={`Qualified suppliers (${qualified.length})`} right={
        <span className="row">
          <CriterionLegend />
          {(isBuyer || ctx.operator) && (
            <button className="btn ghost" onClick={runExplain} disabled={explaining}>
              {explaining ? "Asking the local model…" : "Explain this ranking"}
            </button>
          )}
        </span>}>
        <Status loading={ranked.loading} error={ranked.error} empty={qualified.length === 0}
                emptyText="No supplier meets every hard requirement. The reasons are listed below - relax one requirement or invite new suppliers.">
          <ol className="ranking">
            {qualified.map((s) => {
              const expanded = open === s.result.bpn;
              return (
                <li key={s.result.bpn} className={`rank-row ${s.rank === 1 ? "top" : ""}`}>
                  <span className="rank-no" aria-label={`rank ${s.rank}`}>{s.rank}</span>
                  <div className="rank-who">
                    <button className="link" onClick={() => setOpen(expanded ? null : s.result.bpn)} aria-expanded={expanded}>
                      {s.result.name}
                    </button>
                    <div className="faint">
                      {s.city}, {s.country} · {Math.round(s.result.distanceKm)} km ·{" "}
                      {s.connectorName ? <span title={s.did ?? ""}>EDC connector {s.connectorName}</span> : "no EDC connector yet"}
                    </div>
                    <CertChips verified={s.verifiedCerts} claimed={s.claimedCerts} />
                  </div>
                  <ScoreBars breakdown={s.result.breakdown} score={s.result.score} />
                  <div className="rank-actions">
                    <StateBadge state={s.state} />
                    {isBuyer && <BuyerAction s={s} busy={busy} hasConnector={!!myConnector} running={!!flow && !flow.error && !flow.payload}
                      onShortlist={() => act("sl" + s.result.bpn, () => api.shortlist(rfqId, s.result.bpn), `${s.result.name} shortlisted - waiting for the supplier to accept`)}
                      onDetail={() => requestDetail(s)}
                      onFeedback={(onTime, ok) => act("fb", () => api.feedback(s.matchId!, onTime, ok), "Delivery feedback recorded - it feeds the track record")} />}
                  </div>
                  {expanded && (
                    <div className="rank-detail">
                      {s.summary && <p>{s.summary}</p>}
                      <BreakdownTable breakdown={s.result.breakdown} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Status>
      </Panel>

      {flow && (
        <Panel title={`Contract for ${flow.supplier.result.name}'s confidential capability`}
               right={<button className="btn ghost" onClick={() => setFlow(null)} disabled={!flow.error && !flow.payload && flow.stage < 6}>Close</button>}>
          <Topology active={STAGE_TO_STEP[flow.stage] ?? null} interactive={false}
                    consumer={{ title: `Consumer · ${ctx.me.organisation?.shortName ?? myConnector}`, prefix: prefixOf(ctx, myConnector) }}
                    provider={{ title: `Provider · ${shortOf(ctx, flow.supplier.connectorName)}`, prefix: prefixOf(ctx, flow.supplier.connectorName) }} />
          <ol className="flow-log">
            {flow.log.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
          {flow.error && <div className="error-box">{flow.error}</div>}
          {flow.payload && (
            <details open>
              <summary>Confidential process capability (only visible because a contract exists)</summary>
              <Json value={safeParse(flow.payload)} />
            </details>
          )}
        </Panel>
      )}

      {explain && (
        <Panel title="Why this ranking" right={<span className="faint">{explain.source === "llm" ? "Written by Qwen3.8 (local) from the scorer's figures" : "Template - the local model was unavailable"}</span>}>
          <p className="explain-summary">{explain.summary}</p>
          <ul className="explain-list">
            {explain.perSupplier.map((p) => (
              <li key={p.name}>{p.sentence.startsWith(p.name) ? p.sentence : <><b>{p.name}:</b> {p.sentence}</>}</li>
            ))}
          </ul>
          {explain.risks.length > 0 && <><h3 className="h-small">Risks</h3><ul className="explain-list">{explain.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
          {explain.nextSteps.length > 0 && <><h3 className="h-small">Next steps</h3><ul className="explain-list">{explain.nextSteps.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
        </Panel>
      )}

      {(partners.data?.length ?? 0) > 0 && (
        <Panel title="Partners for the other steps">
          <div className="partners">
            {partners.data!.map((p) => (
              <div key={p.process} className="partner">
                <h3 className="h-small">{p.process}</h3>
                {p.candidates.length === 0 && <div className="muted">No member offers this step for a part this size.</div>}
                {p.candidates.map((c) => (
                  <div key={c.result.bpn} className="partner-row">
                    <span className="rank-no small">{c.rank}</span>
                    <span>{c.result.name}<span className="faint"> · {c.city}, {c.country}</span></span>
                    <span className="mono">{c.result.score.toFixed(3)}</span>
                  </div>
                ))}
                {p.visibleAssets.length > 0 && (
                  <div className="faint">Data you can request from {p.candidates[0]?.result.name}: {p.visibleAssets.map((a) => a.title).join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {rejected.length > 0 && seesAll && (
        <Panel title={`Filtered out (${rejected.length})`}>
          {nearMisses.length > 0 ? (
            <div className="rejected">
              {nearMisses.map((s) => <RejectedRow key={s.result.bpn} s={s} />)}
            </div>
          ) : <div className="muted">No near misses: every other member works in a different trade.</div>}
          {otherTrades.length > 0 && (
            <details className="near-miss-note">
              <summary>{otherTrades.length} other members do not offer {rfq.data?.requiredProcesses.join(" + ")}</summary>
              <div className="rejected" style={{ marginTop: 10 }}>
                {otherTrades.map((s) => <RejectedRow key={s.result.bpn} s={s} />)}
              </div>
            </details>
          )}
        </Panel>
      )}
    </>
  );
}

function RejectedRow({ s }: { s: RankedSupplier }) {
  return (
    <div className="rejected-row">
      <div><b>{s.result.name}</b> <span className="faint">{s.city}, {s.country}</span></div>
      <RejectionList rejections={s.result.rejections} />
    </div>
  );
}

function isBuyerOrg(ctx: Ctx, rfq: Rfq | null) {
  return !!rfq && rfq.buyerBpn === ctx.session.bpn;
}

function BuyerAction({ s, busy, hasConnector, running, onShortlist, onDetail, onFeedback }: {
  s: RankedSupplier; busy: string | null; hasConnector: boolean; running: boolean;
  onShortlist: () => void; onDetail: () => void; onFeedback: (onTime: boolean, qualityOk: boolean) => void;
}) {
  switch (s.state) {
    case "PROPOSED":
      return <button className="btn" onClick={onShortlist} disabled={!!busy}>Shortlist</button>;
    case "SHORTLISTED":
      return <span className="hint">Waiting for {s.result.name.split(" ")[0]} to accept</span>;
    case "ACCEPTED":
      if (!s.connectorName) return <span className="hint">Supplier has no EDC connector - confirm offline</span>;
      if (!hasConnector) return <span className="hint">Your organisation needs an EDC connector to contract</span>;
      return <button className="btn" onClick={onDetail} disabled={running}>Request capability via contract</button>;
    case "CONFIRMED":
      return (
        <span className="row">
          <button className="btn ghost" onClick={() => onFeedback(true, true)} disabled={!!busy} title="Delivered on time, quality OK">Delivered OK</button>
          <button className="btn ghost danger" onClick={() => onFeedback(false, true)} disabled={!!busy} title="Delivered late">Late</button>
        </span>
      );
    default:
      return null;
  }
}

function RfqSpec({ rfq }: { rfq: Rfq }) {
  return (
    <section className="spec">
      <dl>
        <div><dt>Part</dt><dd>{rfq.partFamily ?? "—"} in {rfq.material ?? "any material"}</dd></div>
        <div><dt>Size</dt><dd className="mono">{fmtDims(rfq.dimsMm)}</dd></div>
        <div><dt>Mass</dt><dd className="mono">{fmtMass(rfq.massKg)} × {rfq.quantity}</dd></div>
        <div><dt>Tolerance</dt><dd className="mono">{rfq.tolMm != null ? `± ${rfq.tolMm} mm` : "—"}</dd></div>
        <div><dt>Needed by</dt><dd className="mono">{rfq.dueDate}</dd></div>
        <div><dt>Processes</dt><dd>{rfq.requiredProcesses.join(", ")}</dd></div>
        <div><dt>Certifications</dt><dd>{rfq.requiredCerts.join(", ") || "—"}</dd></div>
      </dl>
      {rfq.story && <p className="spec-story">{rfq.story}</p>}
    </section>
  );
}

function shortOf(ctx: Ctx, connector?: string | null) {
  return ctx.config.connectors.find((c) => c.name === connector)?.short ?? connector ?? "";
}

function prefixOf(ctx: Ctx, connector?: string | null) {
  return ctx.config.connectors.find((c) => c.name === connector)?.publicUrl.match(/:(\d\d)291/)?.[1] ?? "??";
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
