import { useEffect, useMemo, useState } from "react";
import type { AppConfig } from "./config";
import type { Session } from "./auth";
import { Api, Me } from "./api";
import { CertChips, ToastHost, useAsync } from "./ui";
import { Overview } from "./views/Overview";
import { Marketplace } from "./views/Marketplace";
import { Matches } from "./views/Matches";
import { Opportunities } from "./views/Opportunities";
import { Assistant } from "./views/Assistant";
import { Factory } from "./views/Factory";
import { Audit, Catalogue, EdcCatalog, Matrix, Participants, Policies, Transfers } from "./views/DataViews";

/* ------------------------------------------------------------------ routing
   The view lives in the URL hash (#/matches/R1) so views can be bookmarked,
   shared and navigated with the browser's back button. */
export type View =
  | "overview" | "marketplace" | "matches" | "opportunities" | "assistant"
  | "factory" | "catalogue" | "transfers" | "edc" | "audit" | "participants" | "policies" | "matrix";

export interface Route { view: View; arg?: string }

/** Route arguments are ids (e.g. R1, RFQ-97E536A4); anything else is ignored rather than passed on. */
const ARG = /^[A-Za-z0-9_-]{1,64}$/;

function parseHash(): Route {
  const [view, raw] = window.location.hash.replace(/^#\/?/, "").split("/");
  let arg: string | undefined;
  try {
    arg = raw ? decodeURIComponent(raw) : undefined;
  } catch {
    arg = undefined;
  }
  return { view: (view || "overview") as View, arg: arg && ARG.test(arg) ? arg : undefined };
}

export function go(view: View, arg?: string) {
  window.location.hash = `/${view}${arg ? "/" + encodeURIComponent(arg) : ""}`;
}

/** Context every view receives. */
export interface Ctx {
  api: Api;
  config: AppConfig;
  session: Session;
  me: Me;
  /** true if the user's organisation is a REED consortium member */
  member: boolean;
  /** true for the dataspace operator (admin, or an auditor without an organisation) */
  operator: boolean;
}

type Group = "start" | "match" | "data" | "ref";
const NAV: { id: View; label: string; group: Group; roles?: string[]; memberOnly?: boolean; connector?: boolean; factory?: boolean }[] = [
  { id: "overview", label: "Overview", group: "start" },
  { id: "marketplace", label: "Marketplace", group: "match", memberOnly: true },
  { id: "matches", label: "Matches", group: "match", roles: ["buyer", "quality-auditor", "admin"], memberOnly: true },
  { id: "opportunities", label: "Opportunities", group: "match", roles: ["supplier-engineer"], memberOnly: true },  // per supplier capability; the operator has none
  { id: "assistant", label: "Assistant", group: "match", memberOnly: true },
  { id: "factory", label: "Factory", group: "data", factory: true },
  { id: "catalogue", label: "Catalogue", group: "data", memberOnly: true },
  { id: "transfers", label: "Contracts", group: "data", connector: true },
  { id: "edc", label: "EDC catalog", group: "data", memberOnly: true },
  { id: "audit", label: "Audit", group: "data" },
  { id: "participants", label: "Members", group: "ref" },
  { id: "policies", label: "Policies", group: "ref" },
  { id: "matrix", label: "Matrix", group: "ref" },
];

export function App({ config, session }: { config: AppConfig; session: Session }) {
  const api = useMemo(() => new Api(config, session), [config, session]);
  const me = useAsync(() => api.me(), [api]);
  const [route, setRoute] = useState<Route>(parseHash());

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (me.loading && !me.data) return <div className="boot">Connecting to the REED backend…</div>;
  if (me.error || !me.data) {
    return (
      <div className="boot">
        <p>The REED backend did not answer: {me.error}</p>
        <p className="muted">Check that the stack is up (docker compose -f deployment/docker-compose.yml ps) and reload.</p>
      </div>
    );
  }

  const org = me.data.organisation;
  const member = !!org?.consortium || session.has("admin");
  const operator = session.has("admin") || (session.has("quality-auditor") && !session.bpn);
  const ctx: Ctx = { api, config, session, me: me.data, member, operator };
  // Membership and a connector decide what may be opened; roles only decide what the nav offers,
  // so a shared link (e.g. a supplier opening #/matches/R1) still lands on an explanatory page.
  const hasFactory = config.connectors.some((c) => c.factory && c.name === session.participant);
  const allowed = NAV.filter((n) => (!n.memberOnly || member) && (!n.connector || !!session.participant || operator)
    && (!n.factory || hasFactory || operator));
  const visible = allowed.filter((n) => !n.roles || n.roles.some((r) => session.has(r)));
  const view = allowed.some((n) => n.id === route.view) ? route.view : "overview";

  return (
    <ToastHost>
      <div className="app">
        <a className="skip" href="#main">Skip to content</a>
        <header className="topbar">
          <a className="brand" href="#/overview" aria-label="REED overview">
            <span className="mark">REED</span>
            <span className="sub">Manufacturing data space</span>
          </a>
          <nav className="nav" aria-label="Main">
            {visible.map((v, i) => (
              <span key={v.id} style={{ display: "contents" }}>
                {i > 0 && visible[i - 1].group !== v.group && <span className="nav-sep" aria-hidden />}
                <a className={view === v.id ? "active" : ""} aria-current={view === v.id ? "page" : undefined} href={`#/${v.id}`}>
                  {v.label}
                </a>
              </span>
            ))}
          </nav>
          <OrgBadge ctx={ctx} />
        </header>

        <main className="main" id="main" key={view + (route.arg ?? "")}>
          {view === "overview" && <Overview ctx={ctx} />}
          {view === "marketplace" && <Marketplace ctx={ctx} />}
          {view === "matches" && <Matches ctx={ctx} rfqId={route.arg} />}
          {view === "opportunities" && <Opportunities ctx={ctx} />}
          {view === "factory" && <Factory ctx={ctx} />}
          {view === "assistant" && <Assistant ctx={ctx} />}
          {view === "catalogue" && <Catalogue ctx={ctx} />}
          {view === "transfers" && <Transfers ctx={ctx} />}
          {view === "edc" && <EdcCatalog ctx={ctx} />}
          {view === "audit" && <Audit ctx={ctx} />}
          {view === "participants" && <Participants ctx={ctx} />}
          {view === "policies" && <Policies ctx={ctx} />}
          {view === "matrix" && <Matrix ctx={ctx} />}
        </main>

        <footer className="footer">
          <span>REED on Eclipse Dataspace Connector 0.17.0</span>
          <span>Identity: {config.identityMode === "dcp" ? "decentralized claims (verifiable credentials)" : "mock"}</span>
          <span>Assistant: local Qwen3.8 via LiteLLM</span>
        </footer>
      </div>
    </ToastHost>
  );
}

/** Who you are acting as: organisation, role, verified credentials, and log out. */
function OrgBadge({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const org = ctx.me.organisation;
  const role = ctx.session.roles.filter((r) => ["buyer", "supplier-engineer", "quality-auditor", "admin"].includes(r));
  return (
    <div className="org">
      <button className="org-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span className="org-flag">{org?.country ?? "EU"}</span>
        <span className="org-text">
          <span className="org-name">{org?.shortName ?? (ctx.operator ? "Dataspace operator" : "No organisation")}</span>
          <span className="org-role">{ctx.session.username} · {role.join(", ") || "member"}</span>
        </span>
      </button>
      {open && (
        <div className="org-pop" role="dialog" aria-label="Your organisation">
          {org ? (
            <>
              <div className="org-pop-name">{org.name}</div>
              <div className="muted">{org.city}, {org.country} · {org.role} · {org.bpn}</div>
              {!org.consortium && <div className="warn-box">Not a REED consortium member: no credentials, no RFQs, nothing discoverable.</div>}
              {org.did && <div className="mono faint did">{decodeURIComponent(org.did)}</div>}
              <div className="org-pop-label">Verified certifications</div>
              {org.verifiedCerts.length ? <CertChips verified={org.verifiedCerts} /> : <span className="muted">none</span>}
              {org.connectorName
                ? <div className="muted">Runs the EDC connector <span className="mono">{org.connectorName}</span>.</div>
                : <div className="muted">No EDC connector yet: you can be matched, but contracts need a connector.</div>}
            </>
          ) : (
            <div className="muted">Operator account - sees every member's view.</div>
          )}
          <button className="btn ghost" onClick={ctx.session.logout}>Log out</button>
        </div>
      )}
    </div>
  );
}
