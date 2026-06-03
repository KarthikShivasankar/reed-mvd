import type { AppConfig } from "./config";

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

/* ----------------------------- REED client ----------------------------- */
export class Api {
  constructor(private cfg: AppConfig) {}

  private async get<T>(base: string, path: string): Promise<T> {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  classifications() {
    return this.get<Classification[]>(this.cfg.reedBackendUrl, "/reed/classifications");
  }
  policyTemplates() {
    return this.get<PolicyTemplate[]>(this.cfg.reedBackendUrl, "/reed/policy-templates");
  }
  catalogue(bpn: string) {
    return this.get<AssetMetadata[]>(
      this.cfg.reedBackendUrl,
      `/reed/catalogue?bpn=${encodeURIComponent(bpn)}`
    );
  }
  audit() {
    return this.get<AuditEvent[]>(this.cfg.reedBackendUrl, "/reed/audit");
  }

  /* ---- EDC: federated catalog (aggregated, metadata only) ---- */
  async federatedCatalog(): Promise<any> {
    const res = await fetch(this.cfg.federatedCatalogUrl + "/v3/catalogs/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The FC catalogs endpoint expects a QuerySpec, not just a context.
      body: JSON.stringify({
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        "@type": "QuerySpec",
        offset: 0,
        limit: 50,
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  /* ---- EDC: the consumer's point-to-point catalog from the provider ---- */
  async providerCatalog(): Promise<any> {
    const res = await fetch(this.cfg.consumerManagementUrl + "/v3/catalog/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        counterPartyId: this.cfg.provider.id,
        counterPartyAddress: this.cfg.provider.dspUrl,
        protocol: "dataspace-protocol-http:2025-1",
      }),
    });
    if (!res.ok) throw new Error(`catalog ${res.status} ${res.statusText}`);
    return res.json();
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(this.cfg.consumerManagementUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} ${res.status} ${res.statusText}`);
    return res.json();
  }
  private async getJson(path: string): Promise<any> {
    const res = await fetch(this.cfg.consumerManagementUrl + path);
    if (!res.ok) throw new Error(`${path} ${res.status} ${res.statusText}`);
    return res.json();
  }

  negotiate(offerId: string, assetId: string) {
    return this.post("/v3/contractnegotiations", {
      "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
      "@type": "ContractRequest",
      counterPartyId: this.cfg.provider.id,
      counterPartyAddress: this.cfg.provider.dspUrl,
      protocol: "dataspace-protocol-http:2025-1",
      policy: {
        "@context": "http://www.w3.org/ns/odrl.jsonld",
        "@id": offerId,
        "@type": "Offer",
        assigner: this.cfg.provider.id,
        target: assetId,
        permission: [],
        prohibition: [],
        obligation: [],
      },
    });
  }
  getNegotiation(id: string) {
    return this.getJson(`/v3/contractnegotiations/${id}`);
  }
  transfer(agreementId: string, assetId: string) {
    return this.post("/v3/transferprocesses", {
      "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
      "@type": "TransferRequest",
      counterPartyId: this.cfg.provider.id,
      counterPartyAddress: this.cfg.provider.dspUrl,
      protocol: "dataspace-protocol-http:2025-1",
      contractId: agreementId,
      assetId,
      transferType: "HttpData-PULL",
    });
  }
  getTransfer(id: string) {
    return this.getJson(`/v3/transferprocesses/${id}`);
  }
  getEdr(transferId: string) {
    return this.getJson(`/v3/edrs/${transferId}/dataaddress`);
  }
  async pull(endpoint: string, authorization: string): Promise<string> {
    const res = await fetch(endpoint, { headers: { Authorization: authorization } });
    const text = await res.text();
    if (!res.ok) throw new Error(`pull ${res.status}: ${text.slice(0, 200)}`);
    return text;
  }

  /* ---- EDC: connector contract negotiations / transfer processes ---- */
  async list(connectorUrl: string, kind: "contractnegotiations" | "transferprocesses"): Promise<any[]> {
    const res = await fetch(`${connectorUrl}/v3/${kind}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A QuerySpec is required: a bare @context fails JSON-LD expansion (400).
      body: JSON.stringify({
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        "@type": "QuerySpec",
        offset: 0,
        limit: 50,
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [json];
  }
}

/* --------------------- end-to-end REED flow runner --------------------- */
/**
 * Runs the real REED sovereign-exchange flow against the live connectors,
 * exactly like run-transfer.sh: provider catalog → contract offer →
 * negotiation (→ FINALIZED) → HttpData-PULL transfer (→ STARTED) → EDR →
 * data-plane pull of the confidential payload. Shared by the Negotiate tab
 * and the Overview scenario runner so there is a single source of truth.
 *
 * `stage` matches the FLOW labels: 0 fetch offer, 1 negotiate, 2 FINALIZED,
 * 3 transfer, 4 STARTED, 5 EDR, 6 pull payload.
 */
export interface FlowCallbacks {
  onStage: (stage: number) => void;
  onLog?: (msg: string) => void;
}

const flowSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runReedFlow(api: Api, assetId: string, cb: FlowCallbacks): Promise<string> {
  const log = (m: string) => cb.onLog?.(m);

  cb.onStage(0);
  const catalog = await api.providerCatalog();
  const offerId = offerIdFor(catalog, assetId);
  if (!offerId) throw new Error(`no contract offer found for ${assetId} — is it discoverable / seeded?`);
  log(`◆ offer ${offerId.slice(0, 28)}…`);

  cb.onStage(1);
  const neg = await api.negotiate(offerId, assetId);
  const negId = neg["@id"] ?? neg.id;
  log(`◆ negotiation ${negId}`);
  let agreementId = "";
  for (let i = 0; i < 60; i++) {
    const n = await api.getNegotiation(negId);
    const st = val(n.state) ?? val(n["edc:state"]);
    if (st === "FINALIZED") {
      agreementId = val(n.contractAgreementId) ?? val(n["edc:contractAgreementId"]) ?? "";
      break;
    }
    await flowSleep(1500);
  }
  if (!agreementId) throw new Error("negotiation did not reach FINALIZED");
  cb.onStage(2);
  log(`◆ agreement ${agreementId}`);

  cb.onStage(3);
  const tp = await api.transfer(agreementId, assetId);
  const tpId = tp["@id"] ?? tp.id;
  log(`◆ transfer ${tpId}`);
  for (let i = 0; i < 60; i++) {
    const t = await api.getTransfer(tpId);
    if ((val(t.state) ?? val(t["edc:state"])) === "STARTED") break;
    await flowSleep(1500);
  }
  cb.onStage(4);

  let edr: any = null;
  for (let i = 0; i < 30; i++) {
    try {
      edr = await api.getEdr(tpId);
      if (edr) break;
    } catch {
      /* not ready */
    }
    await flowSleep(1500);
  }
  const endpoint = val(edr?.endpoint) ?? val(edr?.["edc:endpoint"]);
  const auth = val(edr?.authorization) ?? val(edr?.["edc:authorization"]);
  if (!endpoint || !auth) throw new Error("EDR not issued in time");
  cb.onStage(5);
  log(`◆ EDR endpoint ${endpoint}`);

  const data = await api.pull(endpoint, auth);
  cb.onStage(6);
  log("◆ confidential payload received ✓");
  return data;
}

/* ----------------------------- helpers --------------------------------- */
export function flattenDatasets(catalog: any): any[] {
  const out: any[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = node["@type"];
    const isDataset = typeof type === "string" ? type.includes("Dataset") : Array.isArray(type) && type.some((t) => String(t).includes("Dataset"));
    if (isDataset && node["@id"]) out.push(node);
    Object.values(node).forEach(visit);
  };
  visit(catalog);
  // de-dup by @id
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d["@id"]) ? false : (seen.add(d["@id"]), true)));
}

export function prop(dataset: any, key: string): string | undefined {
  return dataset?.[key] ?? dataset?.properties?.[key] ?? dataset?.[`reed:${key}`] ?? dataset?.[`https://w3id.org/edc/v0.0.1/ns/${key}`];
}

/** Find the contract-offer @id for a given asset id within a catalog (mirrors run-transfer.sh). */
export function offerIdFor(catalog: any, assetId: string): string | null {
  const datasets = flattenDatasets(catalog);
  const ds = datasets.find((d) => (d["@id"] ?? d.id) === assetId);
  if (!ds) return null;
  let policy = ds["odrl:hasPolicy"] ?? ds["hasPolicy"];
  if (Array.isArray(policy)) policy = policy[0];
  return policy?.["@id"] ?? policy?.id ?? null;
}

/** Unwrap a possibly-namespaced scalar JSON-LD value. */
export function val(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return val(v[0]);
  if (typeof v === "object") return v["@value"] ?? v["@id"];
  return String(v);
}
