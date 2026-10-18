import { useState } from "react";
import type { Ctx } from "../App";
import { BreakdownTable, CriterionLegend, Panel, ScoreBars, StateBadge, Status, fmtDims, fmtMass, useAsync, useToast } from "../ui";
import { Explainer, TAB_HELP } from "../guide";

export function Opportunities({ ctx }: { ctx: Ctx }) {
  const { api, session } = ctx;
  const toast = useToast();
  const opps = useAsync(() => api.opportunities(), [api]);
  const mine = useAsync(() => api.myMatches(), [api]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const answered = (mine.data ?? []).filter((m) => m.supplierBpn === session.bpn && m.state !== "SHORTLISTED");

  async function respond(id: number, accept: boolean) {
    setBusy(id);
    try {
      await (accept ? api.accept(id) : api.decline(id));
      toast("ok", accept ? "Accepted - the buyer can now contract for your capability" : "Declined - the buyer has been told");
      opps.reload();
      mine.reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="view-head">
        <h1>Opportunities</h1>
        <p className="muted">Open RFQs {ctx.me.organisation?.shortName ?? "you"} can make, with your own score. Competitors' scores are never shown.</p>
      </div>
      <Explainer help={TAB_HELP.opportunities} />

      <Panel title="RFQs you qualify for" right={<CriterionLegend />}>
        <Status loading={opps.loading} error={opps.error} empty={(opps.data ?? []).length === 0}
                emptyText="Your public capability does not meet any open RFQ right now. Keep your capability claim and certifications up to date with the operator.">
          <ol className="ranking">
            {[...(opps.data ?? [])].sort((a, b) => Number(b.state === "SHORTLISTED") - Number(a.state === "SHORTLISTED") || b.result.score - a.result.score).map((o) => {
              const expanded = open === o.rfq.id;
              return (
                <li key={o.rfq.id} className="rank-row">
                  <span className="rank-no small">{o.rfq.id}</span>
                  <div className="rank-who">
                    <button className="link" onClick={() => setOpen(expanded ? null : o.rfq.id)} aria-expanded={expanded}>{o.rfq.title}</button>
                    <div className="faint">{o.buyerName} · {o.rfq.material ?? "any material"} · {fmtDims(o.rfq.dimsMm)} · {fmtMass(o.rfq.massKg)} × {o.rfq.quantity} · by {o.rfq.dueDate}</div>
                  </div>
                  <ScoreBars breakdown={o.result.breakdown} score={o.result.score} />
                  <div className="rank-actions">
                    <StateBadge state={o.state} />
                    {o.state === "SHORTLISTED" && o.matchId != null && (
                      <span className="row">
                        <button className="btn" disabled={busy === o.matchId} onClick={() => respond(o.matchId!, true)}>Accept</button>
                        <button className="btn ghost" disabled={busy === o.matchId} onClick={() => respond(o.matchId!, false)}>Decline</button>
                      </span>
                    )}
                    {o.state === "PROPOSED" && <span className="hint">Not shortlisted yet</span>}
                  </div>
                  {expanded && (
                    <div className="rank-detail">
                      {o.rfq.story && <p>{o.rfq.story}</p>}
                      <BreakdownTable breakdown={o.result.breakdown} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Status>
      </Panel>

      {answered.length > 0 && (
        <Panel title="Matches you answered">
          <table className="grid">
            <thead><tr><th>RFQ</th><th>State</th><th>Note</th><th>Updated</th></tr></thead>
            <tbody>
              {answered.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.rfqId}</td>
                  <td><StateBadge state={m.state} /></td>
                  <td className="muted">{m.note ?? "—"}</td>
                  <td className="mono faint">{new Date(m.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
