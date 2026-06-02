export interface ConnectorRef {
  name: string;
  managementUrl: string;
}

export interface BpnRef {
  bpn: string;
  label: string;
}

export interface ProviderRef {
  id: string;
  /** DSP address — resolved by the consumer connector inside Docker, so it is the service name. */
  dspUrl: string;
}

export interface AppConfig {
  reedBackendUrl: string;
  federatedCatalogUrl: string;
  /** Connector whose Management API initiates negotiations (the consumer). */
  consumerManagementUrl: string;
  provider: ProviderRef;
  connectors: ConnectorRef[];
  bpns: BpnRef[];
}

const FALLBACK: AppConfig = {
  reedBackendUrl: "http://localhost:8081",
  federatedCatalogUrl: "http://localhost:39193/management",
  consumerManagementUrl: "http://localhost:29193/management",
  provider: { id: "reed-provider", dspUrl: "http://reed-provider:19194/protocol/2025-1" },
  connectors: [
    { name: "consumer-1", managementUrl: "http://localhost:29193/management" },
    { name: "reed-provider", managementUrl: "http://localhost:19193/management" },
  ],
  bpns: [
    { bpn: "BPN-REED-SUP-0002", label: "Supplier (consumer-1)" },
    { bpn: "BPN-REED-SIM-0003", label: "Simulation service" },
    { bpn: "BPN-REED-OEM-0001", label: "OEM (owner)" },
    { bpn: "BPN-REED-OUT-9999", label: "Outsider (consortium only)" },
  ],
};

/** Loaded at runtime so endpoints can be changed without a rebuild. */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) return FALLBACK;
    return { ...FALLBACK, ...(await res.json()) };
  } catch {
    return FALLBACK;
  }
}
