# Deployment target: Vercel + Supabase Postgres (approved 2026-11-20; not yet built or provisioned)

Arcie deploys as **one Vercel project** (UI, REST, `/events` SSE and the ElevenLabs custom LLM endpoint `/v1/chat/completions`) backed by **one Supabase project** used only as Postgres. Privy stays the identity provider. Circle App Kit stays the only money execution path, and `Arc_Testnet` the only enabled chain.

- Design: `.claude/specs/2026-11-07-vercel-supabase-design.md`
- Implementation plan: `.claude/plans/2026-11-20-vercel-supabase.md`

The earlier Railway + SQLite proposal is **superseded** and must not be used. Until the migration is built, the server still runs locally on SQLite (`pnpm dev`).

## Shape

- Vercel project root: `apps/server`. Hono app exported from `src/index.ts` (zero-config Hono on Vercel Functions with Fluid compute); `src/local.ts` keeps `pnpm dev`. The onramp browser bundle is prebuilt into `public/assets/` at build time.
- Database: Supabase transaction pooler (`DATABASE_URL`, port 6543) with a small pool, verified TLS and prepared statements off. Migrations run only through `pnpm db:migrate` on `DATABASE_MIGRATION_URL`, never on function startup.
- Private `arcie` schema with no access for `anon`/`authenticated`, RLS on, and a restricted `arcie_runtime` role. No database secret reaches the browser.
- Cross-instance safety lives in the database: proposal generations, fenced confirmation claims, a per-user budget lock, persisted wallet provisioning, and a per-session event log behind SSE. Reconciliation runs on read, not at startup.

## Gates (each needs the user's explicit approval)

1. Authentication: a public deployment needs `AUTH_MODE=privy`. `AUTH_MODE=dev` allows unauthenticated REST money actions even though the custom LLM has a shared secret.
2. Provision Supabase and the runtime login role; set Vercel environment variables through a non-logging channel. Never upload `.env` or `recovery/`.
3. Run migrations, then deploy a preview. Verify `/health`, that unauthenticated requests are rejected, Privy login, voice-session extra-body propagation, an authenticated voice and tap confirmation, and that cold start plus first response fits the 15 s cascade timeout.
4. Cutover: pause local writers, take a consistent SQLite backup (including WAL contents), run `pnpm db:import-sqlite <backup>`, verify, then make Vercel the only writer. Never run SQLite and Postgres as competing sources of truth, and never create a replacement demo wallet instead of migrating the existing mapping.
5. ElevenLabs: change only agent `agent_1401m6s51b0ke7zr7se63496bhrz`'s custom LLM URL to the production origin plus `/v1`. Keep `custom_llm.api_key` bound to `arcie_llm_api_key`, the backup LLM disabled and the 15-second cascade timeout.

Rollback: point the agent back to its previous URL. Once Postgres has taken hosted writes, pointing the old server at its stale SQLite copy is **not** a rollback; restore only after reconciling transactions already submitted onchain.
