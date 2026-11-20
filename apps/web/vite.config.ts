import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The Arcie server (apps/server) runs on :8787. Proxy its routes so the app is same-origin in dev.
const API = process.env.ARCIE_API ?? "http://localhost:8787";
const routes = ["/config", "/me", "/balances", "/savings", "/vaults", "/activity", "/intents", "/swaps", "/choices", "/quotes", "/chat", "/receive", "/contacts", "/auth", "/voice", "/events", "/onramp"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    host: true,
    proxy: Object.fromEntries(routes.map((r) => [r, { target: API, changeOrigin: true }])),
  },
});
