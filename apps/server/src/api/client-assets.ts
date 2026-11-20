import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let bundle: Promise<string> | undefined;

/** Bundle the browser-only checkout code once per server process; no CDN or API key. */
export function onrampClientBundle(): Promise<string> {
  bundle ??= build({
    entryPoints: [fileURLToPath(new URL("../client/onramp.ts", import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
  }).then((result) => result.outputFiles![0]!.text).catch((error) => {
    bundle = undefined;
    throw error;
  });
  return bundle;
}
