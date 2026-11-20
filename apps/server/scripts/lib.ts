/** Shared setup for the operator scripts (provision, smoke). Reads the repo-root .env via tsx --env-file. */
import { createCircleAppKit, type AppKitPort } from "@arcie/appkit";
import { createDb, type Db } from "@arcie/db";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing from .env`);
  return v;
}

export function openDb(): Db {
  const url = process.env.DATABASE_URL ?? "./arcie.db";
  return createDb(isAbsolute(url) ? url : resolve(ROOT, url));
}

export function circleClient() {
  return initiateDeveloperControlledWalletsClient({ apiKey: need("CIRCLE_API_KEY"), entitySecret: need("CIRCLE_ENTITY_SECRET") });
}

export function appKit(): AppKitPort {
  const onrampEnvironment = process.env.ONRAMP_ENVIRONMENT ?? "sandbox";
  if (onrampEnvironment !== "sandbox" && onrampEnvironment !== "production") throw new Error("Invalid ONRAMP_ENVIRONMENT.");
  return createCircleAppKit({
    circleApiKey: need("CIRCLE_API_KEY"),
    entitySecret: need("CIRCLE_ENTITY_SECRET"),
    onrampApiKey: need("ONRAMP_API_KEY"),
    onrampEnvironment,
    ...(process.env.ONRAMP_REFERRER_DOMAIN ? { referrerDomain: process.env.ONRAMP_REFERRER_DOMAIN } : {}),
    ...(process.env.APPKIT_API_KEY ? { appKitApiKey: process.env.APPKIT_API_KEY } : {}),
    ...(process.env.ARC_RPC_URL ? { rpcUrls: { Arc_Testnet: process.env.ARC_RPC_URL } } : {}),
  });
}

/** Sets KEY=value in the repo-root .env (replacing an empty or existing line) and in process.env. */
export function setEnv(key: string, value: string): void {
  const path = resolve(ROOT, ".env");
  const env = readFileSync(path, "utf8");
  const line = `${key}=${value}`;
  const next = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${env.trimEnd()}\n${line}\n`;
  writeFileSync(path, next);
  process.env[key] = value;
}
