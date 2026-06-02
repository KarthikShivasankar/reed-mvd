import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { loadConfig } from "./config";

async function boot() {
  const config = await loadConfig();
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App config={config} />
    </React.StrictMode>
  );
}

boot();
