import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLIENT_ASSET_DIR = fileURLToPath(new URL("../../public/assets/", import.meta.url));
export const ONRAMP_ASSET_NAME = "onramp.js";

let bundle: Promise<string> | undefined;

/** Read the prebuilt checkout script, or bundle the browser-only code once for local development. */
export async function onrampClientBundle(assetDir = CLIENT_ASSET_DIR): Promise<string> {
  try {
    return await readFile(join(assetDir, ONRAMP_ASSET_NAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  bundle ??= import("../../scripts/build-assets.js")
    .then(({ bundleOnramp }) => bundleOnramp())
    .catch((error) => {
      bundle = undefined;
      throw error;
    });
  return bundle;
}
