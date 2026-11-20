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
  /** PENDING (onboarding started), ACTIVE or SUSPENDED */
  membershipStatus: string;
  verified: boolean;
  industry: string | null;
  competitorClasses: string[];
}

/* ---- shop floor ---- */
export type SensorStatus = "OK" | "WATCH" | "WARNING" | "ALARM";

export interface SensorView {
  key: string;
  id: string;
  name: string;
  unit: string;
  lo: number | null;
  hi: number | null;
  ts: number | null;
  value: number | null;
  status: SensorStatus | null;
}

export interface FactoryLine {
  participant: string;
  name: string;
  brokerConnected: boolean;
  machines: { id: string; name: string; sensors: SensorView[] }[];
}

export interface SeriesPoint { t: number; avg: number; min: number; max: number }

export interface Insight {
  sensorKey: string;
  machineId: string;
  machine: string;
  sensor: string;
  unit: string;
  latest: number | null;
  slopePerHour: number | null;
  hoursToLimit: number | null;
  status: SensorStatus;
  finding: string;
  action: string | null;
}

export interface Observation {
  id: number;
  participant: string;
  machineId: string | null;
  category: string;
  severity: "low" | "medium" | "high";
  /** null for viewers outside the company (the operator): they get the summary only */
  text: string | null;
  summary: string;
  source: string;
  author: string | null;
  createdAt: string;
}

export interface Briefing { headline: string; actions: string[]; source: string; model: string | null }

/* ---- who gets what (policy evaluator mirroring the connectors' CEL rules) ---- */
export interface Access {
  bpn: string; company: string; connector: string; country: string; role: string;
  visible: boolean; discoverReason: string; granted: boolean; contractReason: string;
}
export interface AssetAccess {
  assetId: string; title: string; assetClass: string; sensitivity: string; ownerBpn: string;
  discoverability: string; policyTemplate: string; discoverTerms: string[]; contractTerms: string[]; access: Access[];
}
export interface Claims {
  member: boolean; role: string | null; country: string | null;
  certifications: string[]; partners: string[]; projects: string[];
}
export interface Offer {
  assetId: string; title: string; assetClass: string; sensitivity: string; ownerBpn: string; owner: string;
  ownerConnector: string; ownerCountry: string; policyTemplate: string; contractTerms: string[]; granted: boolean; reason: string;
}
export interface Inbound { claims: Claims; offers: Offer[] }
export interface InteropRequest { consumer: string; expect: "FINALIZED" | "TERMINATED" | "HIDDEN"; reason?: string; pull?: string[] }
export interface InteropScenario {
  id: string; title: string; story: string; owner: string; asset: string;
  terms: { discoverability: string; policyTemplate: string } | null; requests: InteropRequest[];
}
export interface ControlEvent { action: string; machineId: string; sensorId: string; what: string; at: string }

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
  /** set on a service RFQ (matched against capability offerings) */
  capability: string | null;
  keywords: string[] | null;
  requiredCapacity: number | null;
  preferredRegion: string | null;
  startDate: string | null;
  endDate: string | null;
  purpose: string | null;
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

/* ---- capability offerings, compound policies, contracts, OPA decisions ---- */
/** One ODRL constraint; all constraints of a policy must hold (AND). */
export interface ConstraintForm { leftOperand: string; operator: string; rightOperand: string }
/** One condition of a policy and, in a decision, whether it held. */
export interface Condition { id: string; kind: string; label: string; pass: boolean }
/** A policy at every level: ODRL, its conditions in words, the combined sentence, the generated Rego. */
export interface PolicyView { policyId: string; odrl: any; components: Condition[]; effective: string; rego: string }
export interface Offering {
  id: string; name: string; capability: string; resourceKind: string; resource: string | null; description: string | null;
  keywords: string[]; capacityPerMonth: number | null; providerBpn: string; provider: string; providerCountry: string;
  connector: string | null; assetId: string | null; published: boolean; createdAt: string; publishedAt: string | null;
  policy: PolicyView;
}
export interface OfferingForm {
  name: string; capability: string; resourceKind: string; resource: string; description: string; keywords: string[];
  capacityPerMonth: number | null; assetId: string | null; policy: ConstraintForm[];
}
/** An Open Policy Agent decision. */
export interface Outcome {
  id: number | null; stage: "MATCH" | "RUNTIME" | "SIMULATED"; decision: "ALLOW" | "DENY"; policyId: string;
  decidedBy: string; conditions: Condition[]; failed: Condition[]; explanation: string; at: string;
}
export interface CapabilityCheck { key: string; label: string; pass: boolean; detail: string }
/** `policy` is null when the capability does not match (eligibility is only asked for real candidates). */
export interface ServiceMatch {
  offering: Offering; capabilityChecks: CapabilityCheck[]; capabilityMatch: boolean; policy: Outcome | null;
  policyEligible: boolean; eligible: boolean; contractId: string | null; contractStatus: string | null;
}
export interface ServiceRfqForm {
  title: string; story: string; capability: string; keywords: string[]; requiredCapacity: number | null;
  preferredRegion: string; startDate: string; endDate: string; purpose: string;
}
export interface LifecycleStep { key: string; label: string; detail: string; at: string | null }
export interface Contract {
  id: string; status: "DRAFT" | "NEGOTIATING" | "AGREED" | "ACTIVE" | "EXPIRED" | "TERMINATED"; rfqId: string | null;
  offeringId: string; offering: string; capability: string; resource: string | null; assetId: string;
  providerBpn: string; provider: string; providerConnector: string | null; consumerBpn: string; consumer: string;
  consumerConnector: string | null; startDate: string; expiryDate: string; purpose: string; agreementId: string | null;
  deployedTo: string | null; createdAt: string; updatedAt: string; policy: PolicyView; lifecycle: LifecycleStep[];
  decisions: Outcome[];
}
export interface DecisionRow {
  outcome: Outcome; requesterBpn: string | null; requester: string | null; providerBpn: string | null; provider: string | null;
  contractId: string | null; offeringId: string | null; rfqId: string | null; assetId: string | null; action: string | null;
  purpose: string | null;
}
export interface ConnectorStatus {
  bpn: string; company: string; connector: string; endpoint: string; did: string; online: boolean;
  decisionPoint: string; decisionPointOnline: boolean;
}
export interface CompanyForm {
  name?: string; shortName?: string; role?: string; country?: string; city?: string; industry?: string;
  sectors?: string[]; competitorClasses?: string[]; verified?: boolean;
}
/** The purposes of use a buyer can declare (the backend's list). */
export const PURPOSES = ["pilot-evaluation", "production", "research", "quality-assurance", "maintenance"];

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
/** Management API v4 needs the management/v2 context and an explicit @type. */
const QUERY = { "@context": MGMT_CONTEXT, "@type": "QuerySpec", offset: 0, limit: 50 };
const DSP = "dataspace-protocol-http:2025-1";

/** Query string from the defined values only. */
const q = (params: Record<string, string | undefined>) => {
  const p = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return p.length ? "?" + new URLSearchParams(p).toString() : "";
};

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

  /* ---- shop floor (participant: only the operator picks another company's line) ---- */
  factory(participant?: string) { return this.call<FactoryLine>("GET", `/reed/factory${q({ participant })}`); }
  factorySeries(key: string, range: string, participant?: string) {
    return this.call<SeriesPoint[]>("GET", `/reed/factory/series${q({ participant, key, range })}`);
  }
  factoryInsights(participant?: string) { return this.call<Insight[]>("GET", `/reed/factory/insights${q({ participant })}`); }
  observations(participant?: string) { return this.call<Observation[]>("GET", `/reed/factory/observations${q({ participant })}`); }
  observe(text: string, machineId?: string) { return this.call<Observation>("POST", "/reed/factory/observations", { text, machineId }); }
  briefing(participant?: string) { return this.call<Briefing>("GET", `/reed/factory/briefing${q({ participant })}`); }
  /** Live shop-floor events. Server-sent events read with fetch, so the bearer token travels in a header. */
  async factoryStream(participant: string | undefined, onEvent: (event: string, data: any) => void, signal: AbortSignal) {
    const res = await fetch(`${this.cfg.reedBackendUrl}/reed/factory/stream${q({ participant })}`, {
      headers: { Authorization: `Bearer ${await this.session.token()}`, Accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) throw new ApiError(res.status, `live stream answered ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += value;
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        let event = "message";
        let data = "";
        for (const line of buf.slice(0, i).split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5);
        }
        buf = buf.slice(i + 2);
        if (data) onEvent(event, JSON.parse(data));
      }
    }
  }
  control(action: "drift" | "spike" | "maintain", machineId: string, sensorId?: string) {
    return this.call<ControlEvent>("POST", "/reed/factory/control", { action, machineId, sensorId });
  }
  scenarios() { return this.call<ScenarioFile>("GET", "/reed/scenarios"); }
  interopScenarios() { return this.call<{ scenarios: InteropScenario[] }>("GET", "/reed/scenarios/interop"); }

  /* ---- data sovereignty: who gets an owner's data, and the owner's terms ---- */
  policyAccess(owner?: string) { return this.call<AssetAccess[]>("GET", `/reed/policy/access${q({ owner })}`); }
  policyPreview(assetId: string, discoverability: string, policyTemplate: string) {
    return this.call<AssetAccess>("GET", `/reed/policy/preview${q({ assetId, discoverability, policyTemplate })}`);
  }
  setPolicy(assetId: string, discoverability: string, policyTemplate: string) {
    return this.call<AssetAccess>("PUT", `/reed/assets/${seg(assetId)}/policy`, { discoverability, policyTemplate });
  }
  inbound(bpn?: string) { return this.call<Inbound>("GET", `/reed/policy/inbound${q({ bpn })}`); }

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

  /* ---- capability offerings + compound policies ---- */
  offerings() { return this.call<Offering[]>("GET", "/reed/offerings"); }
  createOffering(form: OfferingForm) { return this.call<Offering>("POST", "/reed/offerings", form); }
  setOfferingPolicy(id: string, policy: ConstraintForm[]) { return this.call<Offering>("PUT", `/reed/offerings/${seg(id)}/policy`, { policy }); }
  publishOffering(id: string) { return this.call<Offering>("POST", `/reed/offerings/${seg(id)}/publish`); }
  /** ODRL constraints -> conditions, combined sentence, ODRL document and Rego; nothing is stored. */
  translatePolicy(policy: ConstraintForm[]) { return this.call<PolicyView>("POST", "/reed/policies/translate", { policy }); }

  /* ---- service RFQs: capability match and policy eligibility, apart ---- */
  createServiceRfq(form: ServiceRfqForm) { return this.call<Rfq>("POST", "/reed/service-rfqs", form); }
  serviceMatches(rfqId: string) { return this.call<ServiceMatch[]>("GET", `/reed/rfqs/${seg(rfqId)}/service-matches`); }

  /* ---- contracts + policy decisions ---- */
  contracts() { return this.call<Contract[]>("GET", "/reed/contracts"); }
  contract(id: string) { return this.call<Contract>("GET", `/reed/contracts/${seg(id)}`); }
  selectProvider(rfqId: string, offeringId: string) { return this.call<Contract>("POST", "/reed/contracts", { rfqId, offeringId }); }
  contractStep(id: string, step: "accept" | "activate" | "terminate") { return this.call<Contract>("POST", `/reed/contracts/${seg(id)}/${step}`); }
  contractAgreed(id: string, agreementId: string) { return this.call<Contract>("POST", `/reed/contracts/${seg(id)}/agreed`, { agreementId }); }
  decisions() { return this.call<DecisionRow[]>("GET", "/reed/policy-decisions"); }
  simulate(body: { contractId?: string; offeringId?: string; requesterBpn?: string; purpose: string; at?: string }) {
    return this.call<Outcome>("POST", "/reed/policy-decisions/simulate", body);
  }

  /* ---- consortium management (operator) ---- */
  onboard(form: CompanyForm) { return this.call<Participant>("POST", "/reed/onboarding", form); }
  updateCompany(bpn: string, form: CompanyForm) { return this.call<Participant>("PUT", `/reed/onboarding/${seg(bpn)}`, form); }
  setMembership(bpn: string, status: string) { return this.call<Participant>("POST", `/reed/onboarding/${seg(bpn)}/status`, { status }); }
  connectorStatus() { return this.call<ConnectorStatus[]>("GET", "/reed/operator/connectors"); }

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
  /** EDR delivered to the backend by the connector's transfer.process.started callback (404 until then). */
  edr(consumer: string, transferId: string) { return this.call<any>("GET", `/reed/connectors/${seg(consumer)}/edrs/${seg(transferId)}`); }
  list(consumer: string, kind: "contractnegotiations" | "transferprocesses") {
    return this.mgmt<any[]>(consumer, "POST", `/v4/${kind}/request`, QUERY).then((j) => (Array.isArray(j) ? j : [j]));
  }
  /** EDR endpoints name the connector's published port; the browser reaches it through this origin (nginx /dp/). */
  private viaOrigin(endpoint: string): string {
    const c = this.cfg.connectors.find((c) => endpoint.startsWith(c.publicUrl));
    if (!c) return endpoint;
    const u = new URL(c.publicUrl);
    return `${window.location.origin}/dp/${c.name}:${u.port}${u.pathname}${endpoint.slice(c.publicUrl.length)}`;
  }
  /** `purpose`: the declared purpose of use, for assets whose policy asks for one. */
  async pull(endpoint: string, authorization: string, purpose?: string): Promise<string> {
    const res = await fetch(this.viaOrigin(endpoint) + (purpose ? `?purpose=${encodeURIComponent(purpose)}` : ""),
      { headers: { Authorization: authorization } });
    const text = await res.text();
    if (!res.ok) {
      let reason = "";
      try { reason = JSON.parse(text).reason ?? ""; } catch { /* not JSON */ }
      throw new ApiError(res.status, reason || `data plane answered ${res.status}: ${text.slice(0, 200)}`);
    }
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
  const agreementId = await agree(api, consumer, provider, assetId, cb);
  return { agreementId, payload: await pullUnder(api, consumer, provider, agreementId, cb) };
}

/** Stages 0-2: catalog -> offer -> negotiation; resolves to the contract agreement id. */
export async function agree(api: Api, consumer: string, provider: ConnectorRef, assetId: string,
                            cb: FlowCallbacks): Promise<string> {
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
  return agreementId;
}

/** Stages 3-6: transfer -> EDR -> pull under an existing agreement; `purpose` is declared to the provider. */
export async function pullUnder(api: Api, consumer: string, provider: ConnectorRef, agreementId: string,
                                cb: FlowCallbacks, purpose?: string): Promise<string> {
  const log = (m: string) => cb.onLog?.(m);
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

  const payload = await api.pull(edr.endpoint, edr.authorization, purpose);
  cb.onStage(6);
  log("Confidential payload received");
  return payload;
}

/** Pulls the first readable sentence out of an EDC policy failure. */
export function policyReason(detail?: string): string {
  if (!detail) return "policy not fulfilled";
  const m = detail.match(/Constraint '([^']+)' (EQ|NEQ|IS_ANY_OF|IS_NONE_OF|IS_ALL_OF) '([^']+)'/);
  if (!m) return detail.slice(0, 160);
  const op = { EQ: "=", NEQ: "≠", IS_ANY_OF: "one of", IS_NONE_OF: "none of", IS_ALL_OF: "all of" }[m[2]];
  const right = m[3].length > 60 ? `${m[3].split(",").length} values` : m[3].replace(/,/g, ", ");
  return `you need ${m[1]} ${op} ${right} (from a verifiable credential)`;
}

/* ----------------------------- helpers --------------------------------- */
export function datasetsOf(catalog: any): any[] {
  // connector catalogs arrive compacted; the federated catalog's are expanded JSON-LD (full IRIs)
  const ds = catalog?.dataset ?? catalog?.["dcat:dataset"] ?? catalog?.["http://www.w3.org/ns/dcat#dataset"] ?? [];
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
