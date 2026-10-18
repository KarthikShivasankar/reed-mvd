import Keycloak from "keycloak-js";
import type { AppConfig } from "./config";

/** The logged-in user as seen in the Keycloak access token. */
export interface Session {
  username: string;
  roles: string[];
  /** Organisation (Business Partner Number) - absent for the dataspace admin. */
  bpn?: string;
  /** Name of the organisation's EDC connector, if it runs one. */
  participant?: string;
  token: () => Promise<string>;
  logout: () => void;
  has: (role: string) => boolean;
}

/**
 * Authorization-code flow with PKCE against the REED realm. login-required
 * sends anonymous visitors straight to the Keycloak login page; tokens are
 * kept in memory only and refreshed shortly before they expire.
 */
export async function login(cfg: AppConfig): Promise<Session> {
  const kc = new Keycloak({ url: cfg.keycloak.url, realm: cfg.keycloak.realm, clientId: cfg.keycloak.clientId });
  await kc.init({ onLoad: "login-required", pkceMethod: "S256", checkLoginIframe: false });
  const claims = (kc.tokenParsed ?? {}) as Record<string, any>;
  const roles: string[] = claims.realm_access?.roles ?? [];
  return {
    username: claims.preferred_username ?? "user",
    roles,
    bpn: claims.bpn,
    participant: claims.participant,
    has: (r) => roles.includes(r),
    token: async () => {
      await kc.updateToken(30);
      return kc.token!;
    },
    logout: () => kc.logout({ redirectUri: window.location.origin }),
  };
}
