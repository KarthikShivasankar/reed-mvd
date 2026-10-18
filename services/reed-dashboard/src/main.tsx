import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { loadConfig } from "./config";
import { login } from "./auth";

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  const config = await loadConfig();
  try {
    const session = await login(config);
    root.render(
      <React.StrictMode>
        <App config={config} session={session} />
      </React.StrictMode>
    );
  } catch (e) {
    root.render(
      <div className="boot">
        <p>Could not reach the login service at {config.keycloak.url}.</p>
        <p className="muted">{String((e as Error)?.message ?? e)} - is Keycloak running? Reload to retry.</p>
      </div>
    );
  }
}

boot();
