import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Same discovery as the old `["packages/*", "apps/*"]` globs, but as inline projects that inherit this config. */
const projects = ["packages", "apps"].flatMap((group) =>
  readdirSync(fileURLToPath(new URL(`./${group}`, import.meta.url)), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      extends: true as const,
      ...(group === "apps" && d.name === "web" ? {
        resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
      } : {}),
      test: { name: d.name, root: fileURLToPath(new URL(`./${group}/${d.name}`, import.meta.url)) },
    })),
);

export default defineConfig({
  test: {
    // Per-project inheritance: each project below runs this setup (it starts one shared Postgres per run).
    globalSetup: [fileURLToPath(new URL("./vitest.global-setup.ts", import.meta.url))],
    projects,
  },
});
