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
      "The REED backend renders each owner's assets into its own connector as offers - metadata and credential-constrained policies only, never the payload. The federated catalog crawls every member's catalog with its own credentials.",
    wire: "seed-reed.sh → POST /v5beta/celexpressions · /v4/assets · /v4/policydefinitions · /v4/contractdefinitions   ·   FC crawler → DSP catalog request",
    layer: "renders all three policy layers from the REED tables",
  },
  {
    id: "discover",
    n: 1,
    title: "Discover",
    plane: "control plane · DSP",
    color: C.cyan,
    blurb:
      "The consumer's control plane asks the provider for its catalog over DSP, presenting verifiable credentials (membership, certifications, supply relations) obtained from its IdentityHub. The provider's access policies decide which offers it may even see - metadata only, no payload.",
    wire: "consumer CP → STS token + verifiable presentation → provider CP: POST /v4/catalog/request (DSP)",
    layer: "catalogue layer - access policy per discoverability, evaluated on credentials",
  },
  {
    id: "negotiate",
    n: 2,
    title: "Negotiate",
    plane: "control plane ↔ control plane",
    color: C.amber,
    blurb:
      "The two control planes run an asynchronous DSP contract negotiation. The provider evaluates its contract policy (e.g. role OEM, DNV certified) as CEL rules over the consumer's credentials. When it reaches FINALIZED, an agreement bound to the consumer's DID exists. No agreement, no data.",
    wire: "consumer CP → POST /v4/contractnegotiations   ·   poll GET /v4/contractnegotiations/{id} → state FINALIZED",
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
    wire: "consumer CP → POST /v4/transferprocesses (transferType HttpData-PULL)   ·   poll → state STARTED",
  },
  {
    id: "edr",
    n: 4,
    title: "EDR",
    plane: "provider → consumer data plane",
    color: C.violet,
    blurb:
      "The provider data plane mints an Endpoint Data Reference — a short-lived ES256 JWT pointing at the provider's public data-plane proxy — and delivers it into the consumer's EDR cache. This is how 'payload only after contract' is enforced on the wire.",
    wire: "consumer CP → transfer.process.started callback → REED backend → { endpoint, authorization: <ES256 JWT> }",
  },
  {
    id: "pull",
    n: 5,
    title: "Pull payload",
    plane: "data plane → REED backend",
    color: C.cyan,
    blurb:
      "The consumer pulls with the EDR JWT. The provider data plane (http-pull-proxy) verifies the token, then fetches the confidential submodel from the REED backend with the owner's own key and streams it back. Every pull writes an audit event - the usage layer.",
    wire: "consumer → GET {edr.endpoint} Authorization: <jwt> → provider DP proxy → GET reed-backend /reed/submodels/{assetId} (per-owner X-Api-Key)",
    layer: "usage layer — ODRL obligations + a PULL audit event on every access",
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
/** One side of the exchange as drawn in the diagram. */
export interface Side {
  title: string;
  /** two-digit port prefix of the connector, e.g. "19" */
  prefix: string;
}

export function Topology({
  active,
  interactive = true,
  consumer = { title: "Consumer · Nordvind (OEM)", prefix: "19" },
  provider = { title: "Provider · Castellum", prefix: "29" },
}: {
  active?: StepId | null;
  interactive?: boolean;
  consumer?: Side;
  provider?: Side;
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

        {/* federated catalog + identity */}
        <Box x={420} y={24} w={200} h={58} title="Federated Catalog" sub=":39193 · crawls all members" variant="fc" active={activeId === "publish" || activeId === "discover"} />
        <Box x={24} y={24} w={300} h={58} title="Own IdentityHub · REED Issuer" sub="DID · verifiable credentials · STS" variant="fc" active={activeId === "discover" || activeId === "negotiate"} />

        {/* consumer */}
        <Box x={24} y={108} w={330} h={332} title={consumer.title} variant="container" />
        <Box x={48} y={150} w={282} h={108} title="Control Plane" sub={`Management :${consumer.prefix}193 · DSP :${consumer.prefix}194`} variant="cp" active={["discover", "negotiate", "transfer"].includes(activeId as string)} />
        <Box x={48} y={292} w={282} h={108} title="Data Plane" sub="EDR cache" variant="dp" active={["edr", "pull"].includes(activeId as string)} />

        {/* provider */}
        <Box x={686} y={108} w={330} h={332} title={provider.title} variant="container" />
        <Box x={710} y={150} w={282} h={108} title="Control Plane" sub={`DSP :${provider.prefix}194 · CEL credential policies`} variant="cp" active={["publish", "discover", "negotiate", "transfer"].includes(activeId as string)} />
        <Box x={710} y={292} w={282} h={108} title="Data Plane" sub={`http-pull-proxy :${provider.prefix}291`} variant="dp" active={["edr", "pull"].includes(activeId as string)} />

        {/* reed backend */}
        <Box x={372} y={476} w={296} h={78} title="REED Backend" sub="registry · matchmaking · submodels :8081" variant="backend" active={activeId === "publish" || activeId === "pull"} />

        {/* ---- flows ---- */}
        {/* publish: backend renders to provider CP, FC crawls provider CP */}
        <Flow step={by("publish")} active={activeId} doneIdx={doneIdx} d="M 668 500 C 860 500 851 330 851 260" label="render assets + policy" lx={905} ly={420} />
        <Flow step={by("publish")} active={activeId} doneIdx={doneIdx} d="M 840 150 C 820 96 700 60 620 56" label="crawl" lx={690} ly={92} anchor="start" />

        {/* discover: consumer CP -> provider CP (DSP catalog request) + FC -> consumer */}
        <Flow step={by("discover")} active={activeId} doneIdx={doneIdx} from={[330, 184]} to={[710, 184]} label="catalog request (DSP)" label2="metadata only" lx={520} ly={176} />
        <Flow step={by("discover")} active={activeId} doneIdx={doneIdx} d="M 300 82 C 300 110 300 130 300 150" label="credentials" lx={312} ly={100} anchor="start" />

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
        <span className="lg"><i style={{ background: "rgba(157,140,255,0.55)" }} /> catalog + identity services</span>
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
            {interactive ? "Press ▶ to walk the flow, or pick a step. " : "Request a supplier's detail to watch the flow light up. "}
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
