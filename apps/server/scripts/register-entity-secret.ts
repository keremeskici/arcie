/**
 * One-time: generate a Circle entity secret, register its ciphertext, save the recovery file,
 * and append CIRCLE_ENTITY_SECRET to the repo-root .env.
 * Follows https://developers.circle.com/wallets/dev-controlled/register-entity-secret
 */
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = `${root}.env`;
const recoveryDir = `${root}recovery`;

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) throw new Error("CIRCLE_API_KEY is required. Set it in .env first.");

const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (/^CIRCLE_ENTITY_SECRET=.+/m.test(env)) {
  throw new Error("CIRCLE_ENTITY_SECRET already exists in .env. Refusing to overwrite it.");
}

const entitySecret = randomBytes(32).toString("hex");
mkdirSync(recoveryDir, { recursive: true });

await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: recoveryDir });

appendFileSync(envPath, `\n# Registered ${new Date().toISOString()}; recovery file in ./recovery\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`);
console.log("Entity secret registered. Recovery file saved in ./recovery. CIRCLE_ENTITY_SECRET added to .env.");
