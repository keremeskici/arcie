import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLIENT_ASSET_DIR, ONRAMP_ASSET_NAME } from "../src/api/client-assets.js";

export async function bundleOnramp(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/client/onramp.ts", import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
  });
  return result.outputFiles[0]!.text;
}

export async function buildAssets(outDir = CLIENT_ASSET_DIR): Promise<void> {
  const code = await bundleOnramp();
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, ONRAMP_ASSET_NAME), code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildAssets();
}
