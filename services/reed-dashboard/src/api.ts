import type { AppConfig, ConnectorRef } from "./config";
import type { Session } from "./auth";

/* ----------------------------- REED types ------------------------------ */
export interface Classification {
  assetClass: string;
  sensitivity: string;
  discoverability: string;
  defaultPolicyTemplate: string;
}

export interface AssetMetadata {
  assetId: string;
  assetClass: string;
  title: string;
  description: string;
  sensitivity: string;
  discoverability: string;
  policyTemplate: string;
  ownerBpn: string;
}

export interface PolicyTemplate {
  name: string;
  description: string;
  odrl: string;
}

export interface AuditEvent {
  id: number;
  eventType: string;
  actorBpn: string | null;
  assetId: string | null;
  detail: string;
  at: string;
}

export interface Capability {
  summary: string;
  processes: string[];
  materials: string[];
  envelopeMm: number[] | null;
  maxMassKg: number | null;
  bestTolMm: number | null;
  leadTimeWeeks: number | null;
  capacity: string | null;
  co2KgPerKg: number | null;
  claimedCerts: string[];
}

export interface Participant {
  bpn: string;
  name: string;
  shortName: string;
  role: string;
  consortium: boolean;
  /** a real company used only in invented demo scenarios */
  illustrative: boolean;
  country: string;
  city: string;
  vatId: string;
  lat: number;
  lon: number;
  portAccess: boolean;
  railAccess: boolean;
  sectors: string[];
  connectorName: string | null;
  did: string | null;
  dspUrl: string | null;
  verifiedCerts: string[];
  capability: Capability | null;
}

export interface Me {
  username: string;
  roles: string[];
  organisation: Participant | null;
}

export interface Rfq {
  id: string;
  buyerBpn: string;
  title: string;
  story: string | null;
  sector: string;
  partFamily: string | null;
  material: string | null;
  dimsMm: number[];
  massKg: number;
  tolMm: number | null;
  quantity: number;
  dueDate: string;
  deliveryLat: number | null;
  deliveryLon: number | null;
  requiredProcesses: string[];
  requiredCerts: string[];
  partnerProcesses: string[];
  state: "OPEN" | "AWARDED" | "CLOSED";
  createdAt: string;
}

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  score: number;
  contribution: number;
  note: string;
}

export interface Rejection {
  code: string;
  detail: string;
}

export interface ScoreResult {
  bpn: string;
  name: string;
  qualified: boolean;
  score: number;
  distanceKm: number;
  trust: number;
  breakdown: Criterion[];
  rejections: Rejection[];
}

export interface RankedSupplier {
  rank: number;
  result: ScoreResult;
  country: string;
  city: string;
  connectorName: string | null;
  did: string | null;
  summary: string | null;
  verifiedCerts: string[];
  claimedCerts: string[];
  detailAssetId: string | null;
  matchId: number | null;
  state: string;
}

export interface PartnerRecommendation {
  process: string;
  candidates: RankedSupplier[];
  visibleAssets: AssetMetadata[];
}

export interface Opportunity {
  rfq: Rfq;
  buyerName: string;
  result: ScoreResult;
  matchId: number | null;
  state: string;
}

export interface MatchRecord {
  id: number;
  rfqId: string;
  buyerBpn: string;
  supplierBpn: string;
  score: number;
  state: string;
  detailAssetId: string | null;
  agreementId: string | null;
  note: string | null;
  onTime: boolean | null;
  qualityOk: boolean | null;
  updatedAt: string;
}

export interface RfqDraft {
  title: string | null;
  sector: string | null;
  partFamily: string | null;
  material: string | null;
  dimsMm: number[] | null;
  massKg: number | null;
  tolMm: number | null;
  quantity: number | null;
  dueInWeeks: number | null;
  requiredProcesses: string[];
  requiredCerts: string[];
  partnerProcesses: string[];
}

export interface DraftResponse {
  draft: RfqDraft;
  missing: string[];
  source: "llm" | "rules";
  model: string | null;
  redactions: number;
  /** the description with personal data removed - what gets stored as the RFQ story */
  redactedText: string;
}

export interface Explanation {
  summary: string;
  perSupplier: { name: string; sentence: string }[];
  risks: string[];
  nextSteps: string[];
  source: "llm" | "rules";
  model: string | null;
}

export interface ChatReply {
  reply: string;
  toolsUsed: string[];
  source: "llm" | "rules";
  model: string | null;
  redactions: number;
}

export interface ScenarioFile {
  rfqs: { id: string; chain: string; buyer: string; title: string; story: string; expectedTop: string }[];
}

/** Error with the backend's own message, so the UI can say what went wrong. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MGMT_CONTEXT = ["https://w3id.org/edc/connector/management/v2"];
/** Management API v4 needs the management/v2 context and an explicit @type (the EDR cache stays on v3). */
const QUERY = { "@context": MGMT_CONTEXT, "@type": "QuerySpec", offset: 0, limit: 50 };
const DSP = "dataspace-protocol-http:2025-1";

/** Encodes one URL path segment, so ids from links (URL hash) can never steer a request to another endpoint. */
const seg = (v: string | number) => encodeURIComponent(String(v));

/* ----------------------------- REED client ----------------------------- */
/**
 * All calls go to the REED backend with the user's bearer token. EDC
 * Management API calls are relayed by the backend (/reed/connectors/{name})
 * which only lets users operate their own organisation's connector and adds
 * the connector key server-side - the browser never holds one.
 */
export class Api {
  constructor(private cfg: AppConfig, private session: Session) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.cfg.reedBackendUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${await this.session.token()}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = j.message || j.error || (Array.isArray(j) ? j[0]?.message : "") || text;
      } catch {
        /* plain text */
      }
      throw new ApiError(res.status, msg || `${res.status} ${res.statusText}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /* ---- directory, model, audit ---- */
  me() { return this.call<Me>("GET", "/reed/me"); }
  participants() { return this.call<Participant[]>("GET", "/reed/participants"); }
  classifications() { return this.call<Classification[]>("GET", "/reed/classifications"); }
  policyTemplates() { return this.call<PolicyTemplate[]>("GET", "/reed/policy-templates"); }
  catalogue(bpn?: string) {
    return this.call<AssetMetadata[]>("GET", `/reed/catalogue${bpn ? `?bpn=${encodeURIComponent(bpn)}` : ""}`);
  }
  audit() { return this.call<AuditEvent[]>("GET", "/reed/audit"); }
  scenarios() { return this.call<ScenarioFile>("GET", "/reed/scenarios"); }

  /* ---- matchmaking ---- */
  rfqs() { return this.call<Rfq[]>("GET", "/reed/rfqs"); }
  rfq(id: string) { return this.call<Rfq>("GET", `/reed/rfqs/${seg(id)}`); }
  createRfq(form: Record<string, unknown>) { return this.call<Rfq>("POST", "/reed/rfqs", form); }
  matches(rfqId: string) { return this.call<RankedSupplier[]>("GET", `/reed/rfqs/${seg(rfqId)}/matches`); }
  partners(rfqId: string) { return this.call<PartnerRecommendation[]>("GET", `/reed/rfqs/${seg(rfqId)}/partners`); }
  opportunities() { return this.call<Opportunity[]>("GET", "/reed/opportunities"); }
  myMatches() { return this.call<MatchRecord[]>("GET", "/reed/matches"); }
  shortlist(rfqId: string, bpn: string) { return this.call<MatchRecord>("POST", `/reed/rfqs/${seg(rfqId)}/shortlist/${seg(bpn)}`); }
  accept(id: number) { return this.call<MatchRecord>("POST", `/reed/matches/${seg(id)}/accept`); }
  decline(id: number) { return this.call<MatchRecord>("POST", `/reed/matches/${seg(id)}/decline`); }
  confirm(id: number, agreementId: string) { return this.call<MatchRecord>("POST", `/reed/matches/${seg(id)}/confirm`, { agreementId }); }
  feedback(id: number, onTime: boolean, qualityOk: boolean) {
    return this.call<MatchRecord>("POST", `/reed/matches/${seg(id)}/feedback`, { onTime, qualityOk });
  }

  /* ---- assistant (local LLM) ---- */
  draftRfq(text: string) { return this.call<DraftResponse>("POST", "/reed/assistant/rfq-draft", { text }); }
  explain(rfqId: string) { return this.call<Explanation>("POST", `/reed/assistant/explain/${seg(rfqId)}`); }
  chat(messages: { role: string; content: string }[]) { return this.call<ChatReply>("POST", "/reed/assistant/chat", { messages }); }

  /* ---- EDC via the backend relay ---- */
  private mgmt<T = any>(connector: string, method: string, path: string, body?: unknown) {
    return this.call<T>(method, `/reed/connectors/${seg(connector)}${path}`, body);
  }
  federatedCatalog() { return this.call<any[]>("POST", "/reed/federated-catalog/v4/catalogs/request", QUERY); }
  catalogOf(consumer: string, provider: ConnectorRef) {
    return this.mgmt(consumer, "POST", "/v4/catalog/request", {
      "@context": MGMT_CONTEXT, "@type": "CatalogRequest",
      counterPartyId: provider.participantId, counterPartyAddress: provider.dspUrl, protocol: DSP,
    });
  }
  negotiate(consumer: string, provider: ConnectorRef, offer: any, assetId: string) {
    return this.mgmt(consumer, "POST", "/v4/contractnegotiations", {
      "@context": MGMT_CONTEXT, "@type": "ContractRequest",
      counterPartyAddress: provider.dspUrl, protocol: DSP,
      // the offer exactly as the provider published it, bound to provider and asset
      policy: { ...offer, assigner: provider.participantId, target: assetId },
    });
  }
  negotiation(consumer: string, id: string) { return this.mgmt(consumer, "GET", `/v4/contractnegotiations/${seg(id)}`); }
  transfer(consumer: string, provider: ConnectorRef, agreementId: string) {
    return this.mgmt(consumer, "POST", "/v4/transferprocesses", {
      "@context": MGMT_CONTEXT, "@type": "TransferRequest",
      counterPartyAddress: provider.dspUrl, protocol: DSP, contractId: agreementId, transferType: "HttpData-PULL",
    });
  }
  transferProcess(consumer: string, id: string) { return this.mgmt(consumer, "GET", `/v4/transferprocesses/${seg(id)}`); }
  edr(consumer: string, transferId: string) { return this.mgmt(consumer, "GET", `/v3/edrs/${seg(transferId)}/dataaddress`); }
  list(consumer: string, kind: "contractnegotiations" | "transferprocesses") {
    return this.mgmt<any[]>(consumer, "POST", `/v4/${kind}/request`, QUERY).then((j) => (Array.isArray(j) ? j : [j]));
  }
  async pull(endpoint: string, authorization: string): Promise<string> {
    const res = await fetch(endpoint, { headers: { Authorization: authorization } });
    const text = await res.text();
    if (!res.ok) throw new Error(`data plane answered ${res.status}: ${text.slice(0, 200)}`);
    return text;
  }
}

/* --------------------- end-to-end REED flow runner --------------------- */
/**
 * The sovereign exchange, exactly like run-transfer.sh, from the user's own
 * connector to a provider: catalog (with verifiable credentials) -> offer ->
 * negotiation (-> FINALIZED) -> HttpData-PULL transfer (-> STARTED) -> EDR ->
 * data-plane pull of the confidential payload.
 *
 * `stage`: 0 fetch offer, 1 negotiate, 2 FINALIZED, 3 transfer, 4 STARTED, 5 EDR, 6 payload.
 */
export interface FlowCallbacks {
  onStage: (stage: number) => void;
  onLog?: (msg: string) => void;
}

export interface FlowResult {
  agreementId: string;
  payload: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runReedFlow(api: Api, consumer: string, provider: ConnectorRef, assetId: string,
                                  cb: FlowCallbacks): Promise<FlowResult> {
  const log = (m: string) => cb.onLog?.(m);

  cb.onStage(0);
  const catalog = await api.catalogOf(consumer, provider);
  const offer = offerFor(catalog, assetId);
  if (!offer) {
    throw new Error(`${provider.short} does not offer ${assetId} to you - your credentials do not satisfy its access policy, or it is not seeded`);
  }
  log(`Offer found in ${provider.short}'s catalog (your MembershipCredential was accepted)`);

  cb.onStage(1);
  const neg = await api.negotiate(consumer, provider, offer, assetId);
  const negId = neg["@id"];
  log(`Negotiation ${negId.slice(0, 8)} started`);
  let agreementId = "";
  for (let i = 0; i < 60; i++) {
    const n = await api.negotiation(consumer, negId);
    if (n.state === "FINALIZED") {
      agreementId = n.contractAgreementId;
      break;
    }
    if (n.state === "TERMINATED") {
      throw new Error(`${provider.short} refused the contract: ${policyReason(n.errorDetail)}`);
    }
    await sleep(1000);
  }
  if (!agreementId) throw new Error("negotiation did not finish within a minute");
  cb.onStage(2);
  log(`Contract agreed (${agreementId.slice(0, 8)})`);

  cb.onStage(3);
  const tp = await api.transfer(consumer, provider, agreementId);
  const tpId = tp["@id"];
  for (let i = 0; i < 60; i++) {
    const t = await api.transferProcess(consumer, tpId);
    if (t.state === "STARTED") break;
    if (t.state === "TERMINATED") throw new Error(`transfer terminated: ${t.errorDetail ?? "no reason given"}`);
    await sleep(1000);
  }
  cb.onStage(4);
  log("Transfer started (HttpData-PULL)");

  let edr: any = null;
  for (let i = 0; i < 30; i++) {
    try {
      edr = await api.edr(consumer, tpId);
      if (edr?.endpoint) break;
    } catch {
      /* not issued yet */
    }
    await sleep(1000);
  }
  if (!edr?.endpoint || !edr?.authorization) throw new Error("no endpoint data reference was issued");
  cb.onStage(5);
  log(`Access token received for ${edr.endpoint}`);

  const payload = await api.pull(edr.endpoint, edr.authorization);
  cb.onStage(6);
  log("Confidential payload received");
  return { agreementId, payload };
}

/** Pulls the first readable sentence out of an EDC policy failure. */
export function policyReason(detail?: string): string {
  if (!detail) return "policy not fulfilled";
  const m = detail.match(/Constraint '([^']+)' EQ '([^']+)'/);
  return m ? `you need ${m[1]} = ${m[2]} (from a verifiable credential)` : detail.slice(0, 160);
}

/* ----------------------------- helpers --------------------------------- */
export function datasetsOf(catalog: any): any[] {
  const ds = catalog?.dataset ?? catalog?.["dcat:dataset"] ?? [];
  return Array.isArray(ds) ? ds : [ds];
}

export function offerFor(catalog: any, assetId: string): any | null {
  const ds = datasetsOf(catalog).find((d) => d["@id"] === assetId);
  if (!ds) return null;
  const p = ds.hasPolicy ?? ds["odrl:hasPolicy"];
  return Array.isArray(p) ? p[0] : p ?? null;
}

export function prop(dataset: any, key: string): string | undefined {
  const v = dataset?.[`reed:${key}`] ?? dataset?.[key] ?? dataset?.properties?.[key];
  return typeof v === "object" && v !== null ? v["@value"] ?? JSON.stringify(v) : v;
}
