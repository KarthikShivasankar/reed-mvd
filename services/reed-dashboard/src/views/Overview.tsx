import type { Ctx } from "../App";
import { go } from "../App";
import { CertChips, Panel, StateBadge, useAsync } from "../ui";
import { Topology } from "../diagram";
import { Explainer, NetworkReference, TAB_HELP } from "../guide";

const CHAINS: Record<string, string> = {
  wind: "Wind energy",
  offshore: "Shipbuilding & offshore",
  rail: "Rail",
  "heavy-machinery": "Heavy machinery",
  hydro: "Hydropower",
};

export function Overview({ ctx }: { ctx: Ctx }) {
  const { api, me, session, member } = ctx;
  const org = me.organisation;
  const rfqs = useAsync(() => (member ? api.rfqs() : Promise.resolve([])), [api, member]);
  const scen = useAsync(() => api.scenarios(), [api]);
  const mine = useAsync(() => (member ? api.myMatches() : Promise.resolve([])), [api, member]);
  const opps = useAsync(() => (member && session.has("supplier-engineer") ? api.opportunities() : Promise.resolve([])), [api, member]);

  const myOpen = (rfqs.data ?? []).filter((r) => r.buyerBpn === session.bpn && r.state === "OPEN");
  const toAnswer = (mine.data ?? []).filter((m) => m.supplierBpn === session.bpn && m.state === "SHORTLISTED");
  const toConfirm = (mine.data ?? []).filter((m) => m.buyerBpn === session.bpn && m.state === "ACCEPTED");
  const byChain = new Map<string, NonNullable<typeof scen.data>["rfqs"]>();
  (scen.data?.rfqs ?? []).forEach((r) => byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), r]));
  const rfqState = (id: string) => rfqs.data?.find((r) => r.id === id)?.state;

  return (
    <>
      <section className="hero">
        <div className="hero-main">
          <h1>{org ? org.name : "REED data space operator"}</h1>
          <p className="hero-sub">
            {org
              ? `${org.city}, ${org.country} · ${roleText(org.role)}${org.connectorName ? ` · connector ${org.connectorName}` : ""}`
              : "You see every member's view and can seed connectors."}
          </p>
          {org && !org.consortium && (
            <div className="warn-box">
              {org.shortName} is not a member of the REED consortium. Without a MembershipCredential it cannot post
              RFQs, discover assets or negotiate contracts. Ask the dataspace operator for onboarding.
            </div>
          )}
          {org && org.consortium && (
            <div className="hero-certs">
              <span className="muted">Verified by the REED issuer:</span>
              <CertChips verified={org.verifiedCerts} />
            </div>
          )}
        </div>
        {member && (
          <div className="todo">
            <h2>Waiting for you</h2>
            <ul>
              {session.has("buyer") && (
                <li><a href="#/marketplace">{myOpen.length} open RFQ{myOpen.length === 1 ? "" : "s"}</a> posted by {org?.shortName ?? "you"}</li>
              )}
              {toConfirm.map((m) => (
                <li key={m.id}><a href={`#/matches/${m.rfqId}`}>Supplier accepted on {m.rfqId}</a> - contract for its capability and confirm</li>
              ))}
              {toAnswer.map((m) => (
                <li key={m.id}><a href="#/opportunities">Shortlisted for {m.rfqId}</a> - accept or decline</li>
              ))}
              {session.has("supplier-engineer") && (
                <li><a href="#/opportunities">{opps.data?.length ?? "…"} open RFQs</a> your capability qualifies for</li>
              )}
              {!session.has("buyer") && !session.has("supplier-engineer") && <li><a href="#/audit">Review the audit trail</a></li>}
              {org?.connectorName && (
                <li><a href="#/dataspace">Who gets your data</a> - set your terms and see what your credentials open at the others</li>
              )}
              {ctx.config.connectors.some((c) => c.factory && c.name === session.participant) && (
                <li><a href="#/factory">Your shop floor</a> - live sensors, alerts, line controls</li>
              )}
            </ul>
          </div>
        )}
      </section>

      <Explainer help={TAB_HELP.overview} />

      <h2 className="block-title">Real-case scenarios</h2>
      <p className="muted block-lede">
        {scen.data ? `${scen.data.rfqs.length} requests` : "Requests"} for large parts from European OEMs. Each shows which
        suppliers qualify, why the others are filtered out, and - where both sides run a connector - the full contract
        and confirmation. Komatsu's (K1, K2) are illustrative: a real company in invented scenarios.
      </p>
      <div className="chains">
        {[...byChain.entries()].map(([chain, list]) => (
          <div className="chain" key={chain}>
            <h3>{CHAINS[chain] ?? chain}</h3>
            {list.map((r) => {
              const canOpen = member && (ctx.operator || r.buyer === session.bpn);
              const state = rfqState(r.id);
              return (
                <button key={r.id} className="scenario" disabled={!canOpen} onClick={() => go("matches", r.id)}
                        title={canOpen ? "Open the ranking" : "Only the buyer sees this ranking; suppliers see their own score under Opportunities"}>
                  <span className="scenario-id">{r.id}</span>
                  <span className="scenario-body">
                    <span className="scenario-title">{r.title}</span>
                    <span className="scenario-story">{r.story}</span>
                  </span>
                  {state && <StateBadge state={state} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <Panel title="How data moves between two members">
        <Topology />
      </Panel>
      <div style={{ marginTop: 14 }}>
        <NetworkReference />
      </div>
    </>
  );
}

function roleText(role: string) {
  return role === "OEM" ? "OEM" : role === "SERVICE" ? "Service provider" : "Supplier";
}
