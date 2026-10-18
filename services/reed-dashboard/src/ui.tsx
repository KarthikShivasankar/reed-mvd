import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Criterion, Rejection } from "./api";

export function SectionHead({ idx, title, desc }: { idx: string; title: string; desc?: string }) {
  return (
    <div className="section-head">
      <span className="idx">{idx}</span>
      <h2>{title}</h2>
      {desc && <span className="desc">{desc}</span>}
    </div>
  );
}

export function Panel({ title, right, children }: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel">
      {title && (
        <div className="panel-head">
          <span>{title}</span>
          {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </div>
  );
}

export function SensitivityChip({ value }: { value: string }) {
  return (
    <span className={`chip sev-${value}`}>
      <span className="dot" />
      {value}
    </span>
  );
}

export function DiscoverabilityChip({ value }: { value: string }) {
  return (
    <span className={`chip disc-${value}`}>
      <span className="dot" />
      {value}
    </span>
  );
}

export function TemplateChip({ value }: { value: string }) {
  return <span className="chip tmpl">{value}</span>;
}

export function Led({ online, label }: { online: boolean | null; label: string }) {
  const cls = online === null ? "" : online ? "online" : "offline";
  return (
    <span className={`led ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

/**
 * JSON viewer with light syntax coloring. Tokenizes into React nodes (no
 * dangerouslySetInnerHTML) so there is no HTML-injection surface even if the
 * payload were ever untrusted.
 */
export function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const parts: React.ReactNode[] = [];
  // match "key": (keys) and : "value" (string values)
  const re = /("[^"]*"\s*:)|(:\s*"[^"]*")/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<span key={i++} className="k">{m[1]}</span>);
    else parts.push(<span key={i++} className="s">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <pre className="code">{parts}</pre>;
}

/* ------------------------------------------------------------------------
   Matchmaking + app-shell components
   ------------------------------------------------------------------------ */

/** Colours of the six scoring criteria, shared by the bars and the legend. */
export const CRITERION_COLORS: Record<string, string> = {
  lead: "var(--amber)",
  tolerance: "var(--cyan)",
  logistics: "var(--violet)",
  trust: "#7fb2ff",
  sector: "#d6c56a",
  carbon: "#5fd38d",
};

/**
 * The score as a stacked "load bar": each segment is one criterion's
 * contribution (weight x normalised score) on a 0..1 scale, with faint ticks
 * marking each criterion's maximum. Hover a segment for its explanation.
 */
export function ScoreBars({ breakdown, score }: { breakdown: Criterion[]; score: number }) {
  let maxOffset = 0;
  return (
    <div className="scorebar" role="img" aria-label={`score ${score.toFixed(3)} of 1`}>
      <div className="scorebar-track">
        {breakdown.map((c) => (
          <span
            key={c.key}
            className="scorebar-seg"
            style={{ width: `${c.contribution * 100}%`, background: CRITERION_COLORS[c.key] }}
            title={`${c.label}: ${c.contribution.toFixed(3)} of ${c.weight.toFixed(2)} - ${c.note}`}
          />
        ))}
        {breakdown.map((c) => {
          maxOffset += c.weight;
          return <span key={"t" + c.key} className="scorebar-tick" style={{ left: `${maxOffset * 100}%` }} />;
        })}
      </div>
      <span className="scorebar-value">{score.toFixed(3)}</span>
    </div>
  );
}

export function CriterionLegend() {
  const labels: Record<string, string> = {
    lead: "Lead time & capacity", tolerance: "Tolerance margin", logistics: "Logistics",
    trust: "Track record", sector: "Sector experience", carbon: "Embedded CO2 (CBAM)",
  };
  return (
    <div className="crit-legend">
      {Object.entries(labels).map(([k, l]) => (
        <span key={k}><i style={{ background: CRITERION_COLORS[k] }} />{l}</span>
      ))}
    </div>
  );
}

export function BreakdownTable({ breakdown }: { breakdown: Criterion[] }) {
  return (
    <table className="grid compact">
      <thead><tr><th>Criterion</th><th className="right">Weight</th><th className="right">Score</th><th className="right">Points</th><th>Why</th></tr></thead>
      <tbody>
        {breakdown.map((c) => (
          <tr key={c.key}>
            <td><i className="swatch" style={{ background: CRITERION_COLORS[c.key] }} />{c.label}</td>
            <td className="right mono">{c.weight.toFixed(2)}</td>
            <td className="right mono">{c.score.toFixed(2)}</td>
            <td className="right mono">{c.contribution.toFixed(3)}</td>
            <td className="muted">{c.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const REJECTION_TEXT: Record<string, string> = {
  PROCESS_MISSING: "Missing process",
  MATERIAL_UNSUPPORTED: "Material not supported",
  ENVELOPE_TOO_SMALL: "Part too large",
  MASS_EXCEEDED: "Part too heavy",
  TOLERANCE_NOT_MET: "Tolerance not reachable",
  LEAD_TIME_EXCEEDED: "Too slow",
  CERT_NOT_VERIFIED: "Certification not verified",
};

export function RejectionList({ rejections }: { rejections: Rejection[] }) {
  return (
    <ul className="rejections">
      {rejections.map((r, i) => (
        <li key={i}><span className="rej-code">{REJECTION_TEXT[r.code] ?? r.code}</span> {r.detail}</li>
      ))}
    </ul>
  );
}

/** Verified certifications (from credentials) vs. self-declared ones that do not count. */
export function CertChips({ verified, claimed = [] }: { verified: string[]; claimed?: string[] }) {
  const unverified = claimed.filter((c) => !verified.includes(c));
  return (
    <span className="certs">
      {verified.map((c) => <span key={c} className="cert ok" title="verified: issued as a credential by the REED issuer">{c}</span>)}
      {unverified.map((c) => <span key={c} className="cert claimed" title="self-declared only - does not count for hard requirements">{c}?</span>)}
    </span>
  );
}

const STATE_TEXT: Record<string, string> = {
  PROPOSED: "Proposed", FILTERED: "Filtered out", SHORTLISTED: "Shortlisted", ACCEPTED: "Accepted by supplier",
  CONFIRMED: "Confirmed", DECLINED: "Declined", REJECTED: "Rejected", OPEN: "Open", AWARDED: "Awarded", CLOSED: "Closed",
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`state state-${state.toLowerCase()}`}>{STATE_TEXT[state] ?? state}</span>;
}

/* ---- toasts: confirm what an action did, or say why it failed ---- */
type Toast = { id: number; kind: "ok" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---- data loading ---- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}

/** Loading / error / empty states with one consistent voice. */
export function Status({ loading, error, empty, emptyText, children }: {
  loading: boolean; error: string | null; empty?: boolean; emptyText?: React.ReactNode; children?: React.ReactNode;
}) {
  if (loading) return <div className="empty"><span className="spinner" aria-hidden /> Loading…</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (empty) return <div className="empty">{emptyText ?? "Nothing here yet."}</div>;
  return <>{children}</>;
}

export function fmtDims(d: number[] | null | undefined) {
  return d ? d.map((x) => (x / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })).join(" × ") + " m" : "—";
}
export function fmtMass(kg: number | null | undefined) {
  return kg == null ? "—" : kg >= 1000 ? `${(kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t` : `${kg} kg`;
}
