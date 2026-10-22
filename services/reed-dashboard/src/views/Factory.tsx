import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import type { Ctx } from "../App";
import type { Briefing, FactoryLine, Insight, Observation, SensorStatus, SensorView, SeriesPoint } from "../api";
import { Led, Panel, Status, useAsync, useToast } from "../ui";
import { Explainer, TAB_HELP } from "../guide";

const RANGES = [["1h", "Last hour"], ["24h", "24 hours"], ["7d", "7 days"]] as const;
type Range = (typeof RANGES)[number][0];
const HOUR = 3_600_000;

/** Status always carries an icon and a word, never colour alone. */
const STATUS: Record<SensorStatus, { icon: string; label: string }> = {
  OK: { icon: "✓", label: "OK" },
  WATCH: { icon: "◔", label: "Watch" },
  WARNING: { icon: "▲", label: "Warning" },
  ALARM: { icon: "■", label: "Alarm" },
};

export function StatusChip({ status }: { status: SensorStatus | null }) {
  if (!status) return <span className="st st-none">… analysing</span>;
  return <span className={`st st-${status}`}><span aria-hidden>{STATUS[status].icon}</span> {STATUS[status].label}</span>;
}

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : v === 0 ? "0" : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 0.1 ? v.toFixed(2) : v.toFixed(3);
const limits = (s: { lo: number | null; hi: number | null; unit: string }) =>
  s.lo != null && s.hi != null ? `${fmt(s.lo)}–${fmt(s.hi)} ${s.unit}` : s.hi != null ? `≤ ${fmt(s.hi)} ${s.unit}` : s.lo != null ? `≥ ${fmt(s.lo)} ${s.unit}` : "no limit";

export function Factory({ ctx }: { ctx: Ctx }) {
  const { api, config, operator } = ctx;
  const toast = useToast();
  const lines = config.connectors.filter((c) => c.factory);
  const [picked, setPicked] = useState(lines[0]?.name);
  const participant = operator ? picked : undefined;  // members always see their own line

  const line = useAsync(() => api.factory(participant), [api, participant]);
  const insights = useAsync(() => api.factoryInsights(participant), [api, participant]);
  const obs = useAsync(() => api.observations(participant), [api, participant]);
  const [live, setLive] = useState<Record<string, { ts: number; value: number }>>({});
  const [spark, setSpark] = useState<Record<string, [number, number][]>>({});
  const [liveObs, setLiveObs] = useState<Observation[]>([]);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // last hour of every sensor for the tiles
  useEffect(() => {
    if (!line.data) return;
    let cancelled = false;
    const keys = line.data.machines.flatMap((m) => m.sensors.map((s) => s.key));
    Promise.all(keys.map((k) => api.factorySeries(k, "1h", participant).then((pts) => [k, pts.map((p) => [p.t, p.avg])] as const)))
      .then((all) => !cancelled && setSpark(Object.fromEntries(all) as Record<string, [number, number][]>))
      .catch(() => {});
    setSelected((s) => s ?? keys[0] ?? null);
    return () => { cancelled = true; };
  }, [api, line.data, participant]);

  // live readings, status changes and observations; reconnects with a fresh token
  const reloadInsights = useRef(insights.reload);
  reloadInsights.current = insights.reload;
  useEffect(() => {
    const abort = new AbortController();
    setLive({});
    setLiveObs([]);
    (async () => {
      while (!abort.signal.aborted) {
        try {
          await api.factoryStream(participant, (event, data) => {
            setConnected(true);
            if (event === "reading") {
              setLive((l) => ({ ...l, [data.key]: { ts: data.ts, value: data.value } }));
              setSpark((sp) => ({ ...sp, [data.key]: [...(sp[data.key] ?? []).filter(([t]) => t > data.ts - HOUR), [data.ts, data.value]] }));
            } else if (event === "insight") {
              reloadInsights.current();
            } else if (event === "observation") {
              setLiveObs((o) => [data, ...o.filter((x) => x.id !== data.id)]);
            }
          }, abort.signal);
        } catch {
          /* dropped or token expired: retry below */
        }
        setConnected(false);
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => abort.abort();
  }, [api, participant]);

  const statusOf = useMemo(() => Object.fromEntries((insights.data ?? []).map((i) => [i.sensorKey, i.status])), [insights.data]);
  const attention = (insights.data ?? []).filter((i) => i.status !== "OK");
  const allObs = [...liveObs, ...(obs.data ?? []).filter((o) => !liveObs.some((l) => l.id === o.id))];
  const sensorByKey = Object.fromEntries((line.data?.machines ?? []).flatMap((m) => m.sensors.map((s) => [s.key, { ...s, machine: m.name }])));
  const sel = selected ? sensorByKey[selected] : undefined;

  return (
    <>
      <div className="view-head">
        <h1>Factory</h1>
        <p className="muted">
          {line.data?.name ?? "Shop-floor line"} · sensors over MQTT, analysed every minute ·{" "}
          <Led online={connected ? true : null} label={connected ? "live" : "connecting…"} />
          {line.data && !line.data.brokerConnected && <span className="hint"> · REED is not connected to the MQTT broker</span>}
        </p>
      </div>
      <Explainer help={TAB_HELP.factory} />

      {operator && lines.length > 1 && (
        <div className="controls">
          <label>Line{" "}
            <select value={picked} onChange={(e) => { setPicked(e.target.value); setSelected(null); }}>
              {lines.map((l) => <option key={l.name} value={l.name}>{l.company}</option>)}
            </select>
          </label>
          <span className="hint">Operator view: read-only</span>
        </div>
      )}

      <div className="factory-top">
        <Panel title="Needs attention" right={<span className="faint">{attention.length} of {(insights.data ?? []).length} sensors</span>}>
          <Status loading={insights.loading && !insights.data} error={insights.error} empty={attention.length === 0}
                  emptyText="Every sensor is steady and within its limits.">
            <ul className="attention">
              {attention.map((i) => <AttentionRow key={i.sensorKey} i={i} onShow={() => setSelected(i.sensorKey)} />)}
            </ul>
          </Status>
        </Panel>
        <BriefingPanel ctx={ctx} participant={participant} />
      </div>

      <Status loading={line.loading && !line.data} error={line.error}>
        <div className="machines">
          {(line.data?.machines ?? []).map((m) => (
            <section key={m.id} className="machine" aria-label={m.name}>
              <h3>{m.name}</h3>
              <div className="tiles">
                {m.sensors.map((s) => (
                  <SensorTile key={s.key} s={s} live={live[s.key]} points={spark[s.key] ?? []}
                              status={statusOf[s.key] ?? s.status} active={selected === s.key} onClick={() => setSelected(s.key)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </Status>

      {sel && <HistoryPanel ctx={ctx} participant={participant} sensor={sel} />}

      <Panel title="Operator observations" right={<span className="faint">tagged by the local model · personal data removed first</span>}>
        {!operator && line.data && <ObservationForm line={line.data} onSent={(o) => {
          setLiveObs((l) => [o, ...l.filter((x) => x.id !== o.id)]);
          toast("ok", `Logged as ${o.severity} ${o.category}${o.machineId ? ` on ${o.machineId}` : ""}`);
        }} ctx={ctx} />}
        <Status loading={obs.loading && !obs.data} error={obs.error} empty={allObs.length === 0} emptyText="No observations yet.">
          <ul className="observations">
            {allObs.map((o) => (
              <li key={o.id} className={`obs sev-${o.severity}`}>
                <div className="obs-head">
                  <span className={`sev sev-${o.severity}`}>{o.severity}</span>
                  <span className="chip">{o.category}</span>
                  <span className="mono">{line.data?.machines.find((m) => m.id === o.machineId)?.name ?? "line"}</span>
                  <span className="faint mono">{new Date(o.createdAt).toLocaleString()} · {o.author} · {o.source}</span>
                </div>
                <div className="obs-summary">{o.summary}</div>
                {o.text !== o.summary && <div className="faint obs-text">“{o.text}”</div>}
              </li>
            ))}
          </ul>
        </Status>
      </Panel>
    </>
  );
}

function AttentionRow({ i, onShow }: { i: Insight; onShow: () => void }) {
  return (
    <li className={`att att-${i.status}`}>
      <StatusChip status={i.status} />
      <div>
        <button className="link" onClick={onShow}>{i.machine}</button>
        <div>{i.finding}</div>
        {i.action && <div className="faint">→ {i.action}</div>}
      </div>
    </li>
  );
}

function BriefingPanel({ ctx, participant }: { ctx: Ctx; participant?: string }) {
  const [b, setB] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try { setB(await ctx.api.briefing(participant)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Panel title="Shift briefing" right={<button className="btn" onClick={run} disabled={busy}>{busy ? "Briefing…" : b ? "Refresh" : "Brief me"}</button>}>
      {err && <p className="error">{err}</p>}
      {!b && !err && <p className="muted">Joins the sensor findings with the operators' observations into what to do this shift.</p>}
      {b && (
        <>
          <p className="briefing-head">{b.headline}</p>
          <ol className="briefing">{b.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
          <p className="faint">{b.source === "llm" ? `Written by ${b.model} (local) from the findings above; every number checked against them.` : "Rule-based (the local model was unavailable)."}</p>
        </>
      )}
    </Panel>
  );
}

function SensorTile({ s, live, points, status, active, onClick }: {
  s: SensorView; live?: { ts: number; value: number }; points: [number, number][]; status: SensorStatus | null; active: boolean; onClick: () => void;
}) {
  const v = live ?? (s.value != null && s.ts != null ? { ts: s.ts, value: s.value } : undefined);
  return (
    <button className={`tile${active ? " active" : ""}`} onClick={onClick} aria-pressed={active}
            aria-label={`${s.name}: ${fmt(v?.value)} ${s.unit}, ${status ?? "analysing"}. Show history`}>
      <div className="tile-head"><span>{s.name}</span><StatusChip status={status} /></div>
      <div className="tile-value"><span className="num">{fmt(v?.value)}</span> <span className="unit">{s.unit}</span></div>
      <Sparkline points={points} lo={s.lo} hi={s.hi} />
      <div className="faint tile-foot">limits {limits(s)}{v && ` · ${new Date(v.ts).toLocaleTimeString()}`}</div>
    </button>
  );
}

/** Last hour, one series: no axes, the limit it is heading for as a hairline when it is in view. */
function Sparkline({ points, lo, hi }: { points: [number, number][]; lo: number | null; hi: number | null }) {
  const W = 160, H = 34;
  if (points.length < 2) return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden />;
  const ys = points.map((p) => p[1]);
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const pad = (y1 - y0) * 0.15 || 1;
  const [min, max] = [y0 - pad, y1 + pad];
  const [t0, t1] = [points[0][0], points[points.length - 1][0]];
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / (max - min)) * (H - 4);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const near = [hi, lo].filter((l): l is number => l != null && l >= min && l <= max);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      {near.map((l) => <line key={l} className="limit" x1={0} x2={W} y1={y(l)} y2={y(l)} />)}
      <path d={d} className="series" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function HistoryPanel({ ctx, participant, sensor }: { ctx: Ctx; participant?: string; sensor: SensorView & { machine: string } }) {
  const [range, setRange] = useState<Range>("24h");
  const [table, setTable] = useState(false);
  const series = useAsync(() => ctx.api.factorySeries(sensor.key, range, participant), [ctx.api, sensor.key, range, participant]);
  return (
    <Panel title={`${sensor.machine} · ${sensor.name} (${sensor.unit})`} right={
      <span className="row">
        <span className="seg" role="group" aria-label="Time range">
          {RANGES.map(([r, label]) => <button key={r} className={r === range ? "active" : ""} aria-pressed={r === range} onClick={() => setRange(r)}>{label}</button>)}
        </span>
        <button className="btn ghost" onClick={() => setTable((t) => !t)}>{table ? "Chart" : "Table"}</button>
      </span>
    }>
      <div style={{ opacity: series.loading ? 0.5 : 1 }}>
        <Status loading={series.loading && !series.data} error={series.error} empty={(series.data ?? []).length === 0} emptyText="No readings in this range.">
          {table ? <SeriesTable points={series.data ?? []} unit={sensor.unit} range={range} />
            : <HistoryChart points={series.data ?? []} unit={sensor.unit} lo={sensor.lo} hi={sensor.hi} range={range} />}
        </Status>
      </div>
    </Panel>
  );
}

const when = (t: number, range: Range) =>
  range === "7d" ? new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Average per bucket (line) inside its min-max band, against the operating limits; crosshair readout on hover. */
function HistoryChart({ points, unit, lo, hi, range }: { points: SeriesPoint[]; unit: string; lo: number | null; hi: number | null; range: Range }) {
  const W = 900, H = 260, L = 56, R = 16, T = 12, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const vals = points.flatMap((p) => [p.min, p.max]).concat([lo, hi].filter((v): v is number => v != null));
  const [v0, v1] = [Math.min(...vals), Math.max(...vals)];
  const pad = (v1 - v0) * 0.08 || 1;
  const [min, max] = [v0 - pad, v1 + pad];
  const [t0, t1] = [points[0].t, points[points.length - 1].t];
  const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join("");
  const band = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.max).toFixed(1)}`).join("")
    + [...points].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.min).toFixed(1)}`).join("") + "Z";
  const yTicks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const xTicks = Array.from({ length: 6 }, (_, i) => t0 + ((t1 - t0) * i) / 5);
  const h = hover != null ? points[hover] : null;

  function move(e: PointerEvent) {
    const r = svg.current!.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (t1 - t0);
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i; });
    setHover(best);
  }

  return (
    <div className="chart">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${unit} history`} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {yTicks.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="tick" x={L - 6} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} className="tick" x={x(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{when(t, range)}</text>
        ))}
        {[["upper limit", hi], ["lower limit", lo]].filter((l): l is [string, number] => l[1] != null).map(([label, v]) => (
          <g key={label}>
            <line className="limit" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="limit-label" x={W - R - 4} y={y(v) - 5} textAnchor="end">{label} {fmt(v)} {unit}</text>
          </g>
        ))}
        <path d={band} className="band" />
        <path d={line} className="series" />
        {h && (
          <g>
            <line className="crosshair" x1={x(h.t)} x2={x(h.t)} y1={T} y2={H - B} />
            <circle className="dot" cx={x(h.t)} cy={y(h.avg)} r={4} />
          </g>
        )}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(h.t) / W) * 100}%` }}>
          <strong>{fmt(h.avg)} {unit}</strong>
          <span className="faint">range {fmt(h.min)}–{fmt(h.max)}</span>
          <span className="faint">{new Date(h.t).toLocaleString()}</span>
        </div>
      )}
      <div className="chart-key faint"><span className="key-line" /> average <span className="key-band" /> min–max per {range === "1h" ? "30 s" : range === "24h" ? "10 min" : "hour"} <span className="key-limit" /> limit</div>
    </div>
  );
}

function SeriesTable({ points, unit, range }: { points: SeriesPoint[]; unit: string; range: Range }) {
  return (
    <div className="table-scroll">
      <table className="grid">
        <thead><tr><th>Time</th><th>Average ({unit})</th><th>Min</th><th>Max</th></tr></thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.t}><td className="mono">{when(p.t, range)}</td><td className="mono">{fmt(p.avg)}</td><td className="mono">{fmt(p.min)}</td><td className="mono">{fmt(p.max)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ObservationForm({ ctx, line, onSent }: { ctx: Ctx; line: FactoryLine; onSent: (o: Observation) => void }) {
  const [text, setText] = useState("");
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      onSent(await ctx.api.observe(text.trim(), machine || undefined));
      setText("");
      setMachine("");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="obs-form" onSubmit={send}>
      <label htmlFor="obs-text">What did you notice?</label>
      <textarea id="obs-text" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Fettling CNC spindle getting louder since 6am, slight rattle at high speed" />
      <div className="row">
        <label>Machine{" "}
          <select value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">Let REED work it out</option>
            {line.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <button className="btn" type="submit" disabled={busy || !text.trim()}>{busy ? "Tagging with the local model…" : "Log observation"}</button>
      </div>
    </form>
  );
}
