/** pnpm check-token <privy-access-token>: verify a real Privy token and print the identity Arcie would use. */
import { createPrivyVerifier } from "../src/auth/verifier.js";
import { need } from "./lib.js";

const token = process.argv[2];
if (!token) {
  console.error("Usage: pnpm check-token <privy-access-token>");
  process.exit(1);
}
const verifier = createPrivyVerifier({
  appId: need("PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET"),
  jwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY || undefined,
});
try {
  console.log(JSON.stringify(await verifier.verify(token), null, 2));
} catch (e) {
  console.error(`Not valid: ${(e as Error).message}`);
  process.exitCode = 1;
}
