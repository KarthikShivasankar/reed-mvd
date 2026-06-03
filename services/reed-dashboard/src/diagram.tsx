import { useEffect, useState } from "react";

/* =========================================================================
   REED topology & flow diagram.

   One canonical picture of the dataspace, reused in two places:
   - Overview: an interactive teaching diagram with a built-in step player +
     a REED supply-chain scenario picker (who is asking for what, and why).
   - Negotiate: the SAME diagram, driven live by the running negotiation so the
     user watches each control-plane / data-plane hop light up as it happens.

   The six steps mirror the EDC adopters' model (see "Dataspace specification
   wiki.md"): a provider PUBLISHES a catalog (metadata only); the consumer
   DISCOVERS it (DSP + federated catalog); the two control planes NEGOTIATE a
   contract; the consumer requests a TRANSFER; the provider data plane mints an
   EDR; and only then can the consumer PULL the confidential payload, which the
   provider data plane fetches from the REED backend submodel store.
   ========================================================================= */

export type StepId = "publish" | "discover" | "negotiate" | "transfer" | "edr" | "pull";

const C = {
  cyan: "#33e1c4",
  amber: "#ffb000",
  violet: "#9d8cff",
  orange: "#ff7a33",
} as const;

export interface Step {
  id: StepId;
  n: number;
  title: string;
  plane: string;
  color: string;
  blurb: string;
  /** The concrete wire calls / messages behind this stage. */
  wire: string;
  /** Which REED policy layer this stage exercises, if any. */
  layer?: string;
}

export const STEPS: Step[] = [
  {
    id: "publish",
    n: 0,
    title: "Publish",
    plane: "provider control plane",
    color: C.orange,
    blurb:
      "The REED backend renders the OEM's asset classes into the provider's control plane as offers — metadata + policy only, never the payload. The federated catalog crawler scrapes that catalog into its aggregated cache.",
    wire: "seed-reed.sh → POST /v3/assets · /v3/policydefinitions · /v3/contractdefinitions   ·   FC crawler → POST /catalog/request",
    layer: "renders all three policy layers from the REED tables",
  },
  {
    id: "discover",
    n: 1,
    title: "Discover",
    plane: "control plane · DSP",
    color: C.cyan,
    blurb:
      "The consumer's control plane requests the provider's DCAT catalog over DSP (or browses the aggregated federated catalog). It learns that data EXISTS — titles, classes, ODRL terms — but receives no payload. The catalogue layer decides what each BPN may even see.",
    wire: "consumer CP → POST /v3/catalog/request (DSP)   ·   REED check → GET /reed/catalogue?bpn=…",
    layer: "catalogue layer — discoverability by BPN + supply-chain graph",
  },
  {
    id: "negotiate",
    n: 2,
    title: "Negotiate",
    plane: "control plane ↔ control plane",
    color: C.amber,
    blurb:
      "The two control planes run an asynchronous DSP contract negotiation. When it reaches FINALIZED, a contract agreement (ODRL, bound to the consumer's participant id) exists. This is the gate — the contract layer. No agreement → no data.",
    wire: "consumer CP → POST /v3/contractnegotiations   ·   poll GET /v3/contractnegotiations/{id} → state FINALIZED",
    layer: "contract layer — the EDC contract policy gates access",
  },
  {
    id: "transfer",
    n: 3,
    title: "Transfer",
    plane: "control plane · DSP",
    color: C.amber,
    blurb:
      "Using the agreement as a token, the consumer's control plane starts an HttpData-PULL transfer process. The provider's control plane reaches STARTED and signals its data plane to prepare access.",
    wire: "consumer CP → POST /v3/transferprocesses (transferType HttpData-PULL)   ·   poll → state STARTED",
  },
  {
    id: "edr",
    n: 4,
    title: "EDR",
    plane: "provider → consumer data plane",
    color: C.violet,
    blurb:
      "The provider data plane mints an Endpoint Data Reference — a short-lived ES256 JWT pointing at the provider's public data-plane proxy — and delivers it into the consumer's EDR cache. This is how 'payload only after contract' is enforced on the wire.",
    wire: "consumer → GET /v3/edrs/{transferId}/dataaddress → { endpoint, authorization: <ES256 JWT> }",
  },
  {
    id: "pull",
    n: 5,
    title: "Pull payload",
    plane: "data plane → REED backend",
    color: C.cyan,
    blurb:
      "The consumer pulls with the EDR JWT. The provider data plane (http-pull-proxy) verifies the token, then fetches the confidential submodel from the REED backend (authenticated by X-Api-Key) and streams it back. Every pull writes an audit event — the usage layer.",
    wire: "consumer → GET {edr.endpoint} Authorization: <jwt> → provider DP proxy → GET reed-backend /reed/submodels/{assetId} (X-Api-Key)",
    layer: "usage layer — ODRL obligations + a PULL audit event on every access",
  },
];

/* ---- REED supply-chain scenarios (the "why" behind a flow) -------------- */
export interface Scenario {
  id: string;
  label: string;
  consumer: string;
  consumerBpn: string;
  asset: string;
  sensitivity: string;
  outcome: "granted" | "denied";
  story: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "supplier",
    label: "Supplier needs process capability",
    consumer: "Tier-1 Supplier",
    consumerBpn: "BPN-REED-SUP-0002",
    asset: "process-capability-001",
    sensitivity: "confidential",
    outcome: "granted",
    story:
      "A tier-1 supplier must confirm it can machine a mating part to tolerance, so it needs the OEM's confidential process-capability data. Because it has a direct SUPPLIES relation, it can discover the bilateral offer, negotiate, and pull — every access logged.",
  },
  {
    id: "sim",
    label: "Simulation partner needs production status",
    consumer: "Simulation Service",
    consumerBpn: "BPN-REED-SIM-0003",
    asset: "production-status-001",
    sensitivity: "restricted",
    outcome: "granted",
    story:
      "A simulation partner on the project needs live production status to schedule a distortion analysis on a bulky welded frame. Its project-scoped relationship makes the asset discoverable under a time-limited pilot policy — permitted, but bounded by an expiry and audited.",
  },
  {
    id: "dpp",
    label: "Partner reads the product passport",
    consumer: "Consortium Member",
    consumerBpn: "BPN-REED-SUP-0002",
    asset: "digital-product-passport-001",
    sensitivity: "consortium",
    outcome: "granted",
    story:
      "Any consortium member may read the Digital Product Passport. It's consortium-visible and dpp-read-only — discoverable to all members, negotiable by all, but usage is read-only and audited.",
  },
  {
    id: "outsider",
    label: "Outsider is blocked",
    consumer: "Outsider",
    consumerBpn: "BPN-REED-OUT-9999",
    asset: "process-capability-001",
    sensitivity: "confidential",
    outcome: "denied",
    story:
      "An outsider with no supply-chain relation tries to reach the same confidential data. The catalogue layer never even reveals the offer — discovery returns nothing, so there is no contract to negotiate and no payload to pull. Sovereignty enforced at step 1.",
  },
];

/* ---- geometry helpers --------------------------------------------------- */
type XY = [number, number];

function flowOpacity(stepId: StepId, active: StepId | null, doneIdx: number): number {
  if (!active) return 0.32;
  if (stepId === active) return 1;
  const i = STEPS.findIndex((s) => s.id === stepId);
  return i < doneIdx ? 0.5 : 0.14;
}

/** A directed (or bi-directional) connector with an optional centered label. */
function Flow({
  step,
  active,
  doneIdx,
  d,
  from,
  to,
  bi,
  label,
  label2,
  lx,
  ly,
  anchor = "middle",
}: {
  step: Step;
  active: StepId | null;
  doneIdx: number;
  d?: string;
  from?: XY;
  to?: XY;
  bi?: boolean;
  label?: string;
  label2?: string;
  lx?: number;
  ly?: number;
  anchor?: "middle" | "start" | "end";
}) {
  const path = d ?? `M ${from![0]} ${from![1]} L ${to![0]} ${to![1]}`;
  const op = flowOpacity(step.id, active, doneIdx);
  const isActive = step.id === active;
  const mid: XY = lx != null && ly != null ? [lx, ly] : from && to ? [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] : [0, 0];
  const mk = `mk-${step.id}`;
  return (
    <g style={{ opacity: op, transition: "opacity .4s ease" }}>
      <path
        d={path}
        fill="none"
        stroke={step.color}
        strokeWidth={isActive ? 2.4 : 1.5}
        strokeDasharray={isActive ? "7 6" : undefined}
        markerEnd={`url(#${mk})`}
        markerStart={bi ? `url(#${mk})` : undefined}
        className={isActive ? "flow-live" : undefined}
      />
      {label && (
        <text
          x={mid[0]}
          y={mid[1]}
          textAnchor={anchor}
          fontFamily="var(--mono)"
          fontSize="10.5"
          fill={step.color}
          style={{ letterSpacing: "0.3px" }}
        >
          <tspan x={mid[0]} dy={label2 ? "-5" : "0"}>
            <tspan fontWeight={700}>{step.n}</tspan> · {label}
          </tspan>
          {label2 && (
            <tspan x={mid[0]} dy="12" fill="var(--text-faint)">
              {label2}
            </tspan>
          )}
        </text>
      )}
    </g>
  );
}

function Box({
  x,
  y,
  w,
  h,
  title,
  sub,
  variant,
  active,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  variant: "container" | "cp" | "dp" | "fc" | "backend";
  active?: boolean;
}) {
  const fill =
    variant === "container"
      ? "transparent"
      : variant === "cp"
      ? "rgba(51,225,196,0.06)"
      : variant === "dp"
      ? "rgba(255,176,0,0.06)"
      : variant === "fc"
      ? "rgba(157,140,255,0.07)"
      : "rgba(255,122,51,0.07)";
  const stroke =
    variant === "cp"
      ? "rgba(51,225,196,0.55)"
      : variant === "dp"
      ? "rgba(255,176,0,0.5)"
      : variant === "fc"
      ? "rgba(157,140,255,0.55)"
      : variant === "backend"
      ? "rgba(255,122,51,0.55)"
      : "var(--line-bright)";
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        fill={fill}
        stroke={stroke}
        strokeWidth={active ? 2 : 1}
        strokeDasharray={variant === "container" ? "4 4" : undefined}
        style={{ transition: "stroke-width .3s" }}
      />
      <text
        x={variant === "container" ? x + 10 : x + w / 2}
        y={variant === "container" ? y + 16 : y + h / 2 - (sub ? 5 : -3)}
        textAnchor={variant === "container" ? "start" : "middle"}
        fontFamily="var(--mono)"
        fontSize={variant === "container" ? "10" : "11.5"}
        fill={variant === "container" ? "var(--text-faint)" : "var(--text)"}
        style={{ letterSpacing: variant === "container" ? "1.5px" : "0.5px", textTransform: "uppercase" as const }}
        fontWeight={variant === "container" ? 400 : 600}
      >
        {title}
      </text>
      {sub && variant !== "container" && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontFamily="var(--mono)" fontSize="9.5" fill="var(--text-faint)" style={{ letterSpacing: "0.5px" }}>
          {sub}
        </text>
      )}
    </g>
  );
}

/* ---- the diagram -------------------------------------------------------- */
export function Topology({
  active,
  interactive = true,
  consumerLabel,
}: {
  active?: StepId | null;
  interactive?: boolean;
  consumerLabel?: string;
}) {
  const controlled = active !== undefined;
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (controlled || !playing) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % STEPS.length), 2600);
    return () => window.clearInterval(t);
  }, [controlled, playing]);

  const activeId: StepId | null = controlled ? active ?? null : idx >= 0 ? STEPS[idx].id : null;
  const doneIdx = activeId ? STEPS.findIndex((s) => s.id === activeId) : -1;
  const activeStep = STEPS.find((s) => s.id === activeId) ?? null;
  const by = (id: StepId) => STEPS.find((s) => s.id === id)!;
  const consumerTitle = consumerLabel ?? "CONSUMER · consumer-1 · BPN-REED-SUP-0002";

  return (
    <div className="topo">
      <svg viewBox="0 0 1040 580" className="topo-svg" role="img" aria-label="REED dataspace topology and flow">
        <defs>
          {STEPS.map((s) => (
            <marker key={s.id} id={`mk-${s.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill={s.color} />
            </marker>
          ))}
        </defs>

        {/* federated catalog */}
        <Box x={420} y={24} w={200} h={58} title="Federated Catalog" sub=":39193 · aggregated cache" variant="fc" active={activeId === "publish" || activeId === "discover"} />

        {/* consumer */}
        <Box x={24} y={108} w={330} h={332} title={consumerTitle} variant="container" />
        <Box x={48} y={150} w={282} h={108} title="Control Plane" sub="Management :29193 · DSP :29194" variant="cp" active={["discover", "negotiate", "transfer"].includes(activeId as string)} />
        <Box x={48} y={292} w={282} h={108} title="Data Plane" sub="EDR cache" variant="dp" active={["edr", "pull"].includes(activeId as string)} />

        {/* provider */}
        <Box x={686} y={108} w={330} h={332} title="PROVIDER · reed-provider · BPN-REED-OEM-0001" variant="container" />
        <Box x={710} y={150} w={282} h={108} title="Control Plane" sub="DSP :19194 · access + contract policy" variant="cp" active={["publish", "discover", "negotiate", "transfer"].includes(activeId as string)} />
        <Box x={710} y={292} w={282} h={108} title="Data Plane" sub="http-pull-proxy :19291" variant="dp" active={["edr", "pull"].includes(activeId as string)} />

        {/* reed backend */}
        <Box x={372} y={476} w={296} h={78} title="REED Backend" sub="submodel store · source of truth :8081" variant="backend" active={activeId === "publish" || activeId === "pull"} />

        {/* ---- flows ---- */}
        {/* publish: backend renders to provider CP, FC crawls provider CP */}
        <Flow step={by("publish")} active={activeId} doneIdx={doneIdx} d="M 668 500 C 860 500 851 330 851 260" label="render assets + policy" lx={905} ly={420} />
        <Flow step={by("publish")} active={activeId} doneIdx={doneIdx} d="M 840 150 C 820 96 700 60 620 56" label="crawl" lx={690} ly={92} anchor="start" />

        {/* discover: consumer CP -> provider CP (DSP catalog request) + FC -> consumer */}
        <Flow step={by("discover")} active={activeId} doneIdx={doneIdx} from={[330, 184]} to={[710, 184]} label="catalog request (DSP)" label2="metadata only" lx={520} ly={176} />
        <Flow step={by("discover")} active={activeId} doneIdx={doneIdx} d="M 420 60 C 320 70 230 100 200 150" label="aggregated" lx={300} ly={96} anchor="end" />

        {/* negotiate: CP <-> CP */}
        <Flow step={by("negotiate")} active={activeId} doneIdx={doneIdx} from={[330, 212]} to={[710, 212]} bi label="contract negotiation → FINALIZED" lx={520} ly={228} />

        {/* transfer: consumer CP -> provider CP */}
        <Flow step={by("transfer")} active={activeId} doneIdx={doneIdx} from={[330, 244]} to={[710, 244]} label="transfer start · HttpData-PULL" lx={520} ly={262} />

        {/* edr: provider DP -> consumer DP */}
        <Flow step={by("edr")} active={activeId} doneIdx={doneIdx} from={[710, 326]} to={[330, 326]} label="EDR · ES256 JWT" lx={520} ly={318} />

        {/* pull: consumer DP -> provider DP, provider DP -> backend */}
        <Flow step={by("pull")} active={activeId} doneIdx={doneIdx} from={[330, 358]} to={[710, 358]} label="pull payload (EDR)" lx={520} ly={376} />
        <Flow step={by("pull")} active={activeId} doneIdx={doneIdx} d="M 760 400 C 720 460 690 470 660 492" label="fetch submodel" label2="X-Api-Key" lx={770} ly={450} anchor="start" />
      </svg>

      {/* legend */}
      <div className="topo-legend">
        <span className="lg"><i style={{ background: "rgba(51,225,196,0.5)" }} /> control plane</span>
        <span className="lg"><i style={{ background: "rgba(255,176,0,0.5)" }} /> data plane</span>
        <span className="lg"><i style={{ background: "rgba(157,140,255,0.55)" }} /> federated catalog</span>
        <span className="lg"><i style={{ background: "rgba(255,122,51,0.55)" }} /> REED backend</span>
      </div>

      {/* step rail */}
      <div className="topo-rail">
        {interactive && (
          <div className="topo-controls">
            <button className="btn ghost sq" title="previous step" onClick={() => { setPlaying(false); setIdx((i) => (i <= 0 ? STEPS.length - 1 : i - 1)); }}>‹</button>
            <button className="btn sq play" title={playing ? "pause" : "play"} onClick={() => { if (idx < 0) setIdx(0); setPlaying((p) => !p); }}>{playing ? "❚❚" : "▶"}</button>
            <button className="btn ghost sq" title="next step" onClick={() => { setPlaying(false); setIdx((i) => (i + 1) % STEPS.length); }}>›</button>
          </div>
        )}
        <div className="topo-steps">
          {STEPS.map((s) => {
            const st = s.id === activeId ? "active" : doneIdx > STEPS.findIndex((x) => x.id === s.id) ? "done" : "";
            return (
              <button
                key={s.id}
                className={`step-pill ${st}`}
                style={{ ["--c" as any]: s.color }}
                disabled={controlled}
                onClick={() => { setPlaying(false); setIdx(STEPS.findIndex((x) => x.id === s.id)); }}
              >
                <span className="n">{s.n}</span>
                {s.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* description */}
      <div className="topo-desc">
        {activeStep ? (
          <>
            <div className="topo-desc-head" style={{ color: activeStep.color }}>
              <span className="n" style={{ background: activeStep.color }}>{activeStep.n}</span>
              {activeStep.title}
              <span className="plane">{activeStep.plane}</span>
            </div>
            <p>{activeStep.blurb}</p>
            <div className="topo-wire">
              <span className="topo-wire-tag">wire</span>
              <code>{activeStep.wire}</code>
            </div>
            {activeStep.layer && (
              <div className="topo-wire">
                <span className="topo-wire-tag" style={{ color: activeStep.color, borderColor: activeStep.color }}>layer</span>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{activeStep.layer}</span>
              </div>
            )}
          </>
        ) : (
          <p className="muted">
            {interactive ? "Press ▶ to walk the flow, or pick a step. " : "Run a negotiation to watch the flow light up. "}
            Each hop shows whether it happens on the <b>control plane</b> (discover / negotiate / transfer) or the <b>data plane</b> (EDR / pull) — and between which connector.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---- guided click-path -------------------------------------------------- */
export interface GuidedItem {
  n: number;
  title: string;
  desc: string;
  to: string;
}

export function GuidedPath({ items, onJump }: { items: GuidedItem[]; onJump: (v: any) => void }) {
  return (
    <div className="guided">
      {items.map((it) => (
        <button key={it.n} className="guided-step" onClick={() => onJump(it.to)}>
          <span className="guided-num">{it.n}</span>
          <span className="guided-body">
            <span className="guided-title">{it.title}</span>
            <span className="guided-desc">{it.desc}</span>
          </span>
          <span className="guided-go">→</span>
        </button>
      ))}
    </div>
  );
}
