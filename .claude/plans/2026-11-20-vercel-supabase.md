# Vercel + Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Arcie's existing Hono server (UI, REST, `/events`, `/v1/chat/completions`) as one Vercel project backed by Supabase Postgres, with payment safety that holds across many function instances.

**Architecture:** SQLite becomes Drizzle Postgres (async everywhere). Process-local coordination (the proposal generation map, the confirmation set, in-flight wallet creation, the EventEmitter bus, and startup reconciliation) moves into database rows, locks and a per-session event log. The SSE route tails that log. One Hono app is exported for Vercel; a separate local entry keeps `pnpm dev`.

**Tech Stack:** TypeScript, Hono 4, Drizzle ORM 0.45 (`drizzle-orm/postgres-js`), `postgres` (postgres.js), `embedded-postgres` (tests only), Vitest 5, Vercel Functions (Node, Fluid compute), Supabase Postgres via the transaction pooler.

**Spec:** `.claude/specs/2026-11-07-vercel-supabase-design.md` (approved 2026-11-20). Background: `.claude/specs/2026-11-06-arcie-backend-design.md` §8.3 (harness), §9 (islands/SSE), §17 (Privy).

## Global Constraints

- Circle App Kit with the circle-wallets adapter stays the only money execution provider. `Arc_Testnet` stays the only enabled chain. Every write goes through `harness.confirm`; the LLM never executes.
- Keep Privy for identity. Supabase is the database only: no Supabase Auth, no browser Supabase client, no `auth.uid()`.
- Preserve `/v1/chat/completions`, every REST route, `/events`, existing UI routes and their response shapes (amounts stay exact strings; timestamps stay ISO-8601 strings).
- Use Postgres for local integration tests too. Don't validate Postgres concurrency with SQLite or mocked transactions.
- Never hold a database transaction open across a Circle, OpenAI, Privy or RPC network call.
- Recovery observes settlement. It never resubmits a money action. Retry database work only when it has no external side effects.
- Never run migrations on function startup. Run them explicitly over a dedicated migration connection.
- Hosted connections use the Supabase transaction pooler, a small pool, verified TLS and `prepare: false`.
- The application schema is private (`arcie`). Browser roles (`anon`, `authenticated`) get no access; RLS is on as defense in depth, with explicit policies for a restricted runtime role (`arcie_runtime`). Migrations run as a separate owner.
- Never read or print `.env` or `recovery/`. Never commit a database or exported records.
- No push, merge, deploy, hosted provisioning, secret transfer, data transfer or ElevenLabs URL change without the user's explicit approval at that step.
- Test first for every behavior change. Run `pnpm test && pnpm typecheck` before every commit. Record every implementation judgment call as a `Ruling:` line in `.superpowers/sdd/2026-11-20-vercel-supabase/progress.md`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A function is killed after Circle accepts a submission but before `txHash` is stored.** The intent stays `executing` with its budget reserved. Reconciliation marks it `submission_unknown` and never resubmits. (Test: Task 5 `kill after submit keeps reservation`.)
2. **An SSE client reconnects with `Last-Event-ID` after the server closes the stream at its duration cap in the middle of a burst.** The client gets every event exactly once, in order. (Test: Task 7 `resume across forced close`.)
3. **Two instances' clocks disagree.** Claim expiry and event retention use the database's `now()`, never the instance clock. (Test: Task 4 `claim expiry ignores instance clock`.)
4. **Two first logins for one user land on two instances at the same time.** Exactly one Circle wallet is created and mapped. (Test: Task 6 `concurrent onboarding on two pools`.)
5. **A cold start imports the Vercel entry.** Importing it opens no connection and runs no migrations until the first request, so voice stays inside the 15 s cascade timeout. (Test: Task 9 `entry import is side-effect free`.)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema.ts` | Postgres schema in `pgSchema("arcie")`; existing tables plus `session_state`, `session_events`, `confirm_claims`, `wallet_provisioning`; `intents.revision` and `intents.reconcile_checked_at` columns |
| `packages/db/src/client.ts` | `createDb(url, opts)` → `{ db, close }`; no migrations |
| `packages/db/src/migrate.ts` | `migrateDb(url)`: explicit migrations over the migration connection |
| `packages/db/drizzle/` | Fresh Postgres migration history (the SQLite history moves to `packages/db/drizzle-sqlite/` for the importer's tests only) |
| `packages/db/src/testing.ts` | `createTestDb()`: a fresh database per test file, cloned from a migrated template |
| `vitest.global-setup.ts` | Starts one embedded Postgres per run (or uses `TEST_DATABASE_URL`) and builds the template |
| `packages/harness/src/coordination.ts` | Proposal generations, confirmation claims, the budget lock + execution claim |
| `packages/harness/src/events.ts` | `EventLog` (append in a transaction, read after a cursor, snapshot) replacing `EventBus`; `StepTracker` writes through it |
| `packages/appkit/src/wallets.ts` | Persisted, idempotency-keyed wallet provisioning |
| `apps/server/src/events/sse.ts` | Snapshot + cursor, tail by polling, `Last-Event-ID` resume, duration-capped streams |
| `apps/server/src/reconcile.ts` | `reconcileIntent` / `reconcileUser`: bounded, deduplicated, on-demand checks |
| `apps/server/src/runtime.ts` | `createRuntime(env)`: builds every dependency lazily from env |
| `apps/server/src/index.ts` | Vercel entry: `export default app` (lazy runtime) |
| `apps/server/src/local.ts` | Local `serve()` entry for `pnpm dev` / `pnpm start` |
| `apps/server/scripts/import-sqlite.ts` | One-shot SQLite backup → empty Postgres import with verification |
| `apps/server/vercel.json` | Install/build commands and `maxDuration` for the functions |

---

### Task 1: Postgres schema, client and test database

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/index.ts`, `packages/db/drizzle.config.ts`, `packages/db/package.json`, `vitest.config.ts`
- Move: `packages/db/drizzle/` → `packages/db/drizzle-sqlite/`; keep `schema.ts`'s SQLite version as `packages/db/src/sqlite-schema.ts` (read-only, used only by Task 10)
- Create: `packages/db/src/migrate.ts`, `packages/db/src/testing.ts`, `vitest.global-setup.ts`, `packages/db/drizzle/0000_*.sql` (generated)
- Test: `packages/db/src/client.test.ts`

**Interfaces:**
- Produces: `type Db = PostgresJsDatabase<typeof schema>`; `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]`; `type DbOrTx = Db | Tx`; `createDb(url: string, opts?: { max?: number; ssl?: "require" | false }): { db: Db; close(): Promise<void> }` (always `prepare: false`); `migrateDb(url: string): Promise<void>`; `createTestDb(): Promise<{ db: Db; url: string; close(): Promise<void> }>`. All existing table exports keep their names and column property names.

Decisions: timestamps stay `text` ISO strings (so API formats and the existing string comparisons are unchanged); JSON columns become `jsonb` with the same `$type<>`; `audit.id` becomes `bigint generated always as identity` (mode `"number"`); everything lives in `pgSchema("arcie")`. Add `embedded-postgres` as a root devDependency; the global setup starts it on a free port in `.superpowers/pg-test/` (git-ignored), migrates a `arcie_template` database, and exposes its URL through `inject()`. `createTestDb()` runs `CREATE DATABASE t_<random> TEMPLATE arcie_template`. If `TEST_DATABASE_URL` is set, use that server instead of starting one. `better-sqlite3` moves to devDependencies (only the importer needs it).

- [ ] **Step 1: Write failing tests** in `client.test.ts`:
  - `migrates into the private arcie schema`: after `createTestDb()`, `select table_name from information_schema.tables where table_schema='arcie'` includes `users, wallets, contacts, limits, sessions, intents, choices, audit`, and `public` contains none of them.
  - `createDb never migrates`: `createDb` against an empty database, then `select to_regclass('arcie.users')` is `null`.
  - `round-trips jsonb and text timestamps`: insert an intent with `params: { amount: "1.000001" }` and `createdAt: "2026-11-20T00:00:00.000Z"`; reading it back yields identical values (string amount, string timestamp).
  - `two test databases are isolated`: a user inserted in one isn't visible in another.
- [ ] **Step 2:** Run `pnpm vitest run packages/db/src/client.test.ts`. Expected: FAIL (`createTestDb` is not exported).
- [ ] **Step 3:** Port `schema.ts` to `pg-core`, implement `client.ts`, `migrate.ts`, `testing.ts` and the global setup; register it as `globalSetup` in `vitest.config.ts`; run `pnpm --filter @arcie/db db:generate` to produce `drizzle/0000_*.sql`.
- [ ] **Step 4:** Run the same test. Expected: PASS. Other packages still fail to typecheck at this point; that's expected until Task 2.
- [ ] **Step 5:** Commit with Task 2 (the repository doesn't typecheck between them). Don't commit separately.

### Task 2: Make every database call async on Postgres

**Files:**
- Modify (non-test): `packages/db/src/seed.ts`, `packages/appkit/src/wallets.ts`, `packages/harness/src/{audit,harness,services}.ts`, `packages/harness/src/intents/repo.ts`, `packages/harness/src/policy/db-provider.ts`, `packages/harness/src/tools/read.ts`, `apps/server/src/{reconcile,testkit,index}.ts`, `apps/server/src/api/{contacts,me,http}.ts`, `apps/server/src/auth/{onboard,identify}.ts`, `apps/server/src/llm/route.ts`, `apps/server/scripts/{lib,evals}.ts`
- Modify (tests): every `*.test.ts` that calls `createDb(":memory:")` (16 files) or `.run()/.get()/.all()` (12 files, 32 calls)

**Interfaces:**
- Consumes: Task 1's `Db`, `DbOrTx`, `createTestDb`.
- Produces: every `IntentRepo` method returns a `Promise` (same names and arguments); `audit(db: DbOrTx, ctx, type, payload, intentId?): Promise<void>`; `resolveRecipient(...)`: `Promise<RecipientResult>`; `resolveVoiceSession(db, sid)`: `Promise<...>`; `testApp()` returns the same shape plus `close(): Promise<void>`; `IntentRepo` takes `DbOrTx` so later tasks can run it inside a transaction.

This task is a mechanical port: no behavior changes. `.get()` becomes `await …limit(1)` then `[0] ?? null`; `.run().changes === 1` becomes `(await ….returning({ id })).length === 1`; `.all()` becomes `await`. The SQLite `db.transaction(() => …)` in `confirmOnce` and `reconcile.finish` becomes `await db.transaction(async (tx) => …)` with the same body, still sync-free of network calls. In-process maps stay until Tasks 3–7. Each test file uses `createTestDb()` in `beforeEach` and `close()` in `afterEach`.

- [ ] **Step 1:** Switch `testkit.ts` and the 16 test files to `createTestDb()`, and add `await` to the 32 test calls. Run `pnpm test`. Expected: FAIL with type and runtime errors from the sync code.
- [ ] **Step 2:** Port the non-test files listed above.
- [ ] **Step 3:** Run `pnpm test && pnpm typecheck`. Expected: all 273 existing tests PASS, typecheck clean. If any existing assertion has to change, stop and record a `Ruling:` explaining why. Don't weaken it silently.
- [ ] **Step 4:** Commit Tasks 1–2: `refactor(db): move to Drizzle Postgres with async access`.

### Task 3: Persisted proposal generations and one pending intent per session

**Files:**
- Modify: `packages/db/src/schema.ts` (add `sessionState`), `packages/harness/src/harness.ts:44-105,250-262`, `packages/harness/src/intents/repo.ts` (`create`, `supersedeOpen`)
- Create: `packages/harness/src/coordination.ts`, `packages/db/drizzle/0001_*.sql`
- Test: `packages/harness/src/coordination.test.ts`

**Interfaces:**
- Produces: table `session_state(session_id text pk, proposal_generation integer not null default 0, next_event_seq bigint not null default 1)` (Task 7 uses `next_event_seq`); a partial unique index `intents_one_pending_per_session on intents(session_id) where status = 'awaiting_confirmation'`; `beginProposal(db: Db, sessionId: string): Promise<number>` (increments and returns the new generation); `bumpGeneration(db: Db, sessionId: string): Promise<boolean>` (for cancel; returns true if a preparation was in flight, meaning generation > the last published one); `publishProposal<T>(db: Db, sessionId: string, generation: number, fn: (tx: Tx) => Promise<T>): Promise<T | null>` runs `fn` only if, while holding `select … for update` on the `session_state` row, the generation is still current; otherwise it returns `null`. Supersession of old intents and insertion of the new one happen inside `fn`.

Track "a preparation is in flight" with a column `preparing_generation integer` (set by `beginProposal`, cleared by `publishProposal`/finish). `cancel` reports "I stopped preparing that" when it was set. Replace the `preparations` map entirely.

- [ ] **Step 1: Write failing tests** (each uses two separate `createDb` pools on the same test database, to act as two instances):
  - `cancel on another instance stops a delayed proposal`: instance A calls `propose` with a `FakeAppKit` whose estimate waits on a latch; instance B calls `cancel`; release the latch. Expect A's result `data.cancelled === true`, zero `awaiting_confirmation` intents and zero choices for the session.
  - `newer proposal wins on another instance`: A starts proposal 1 (latched), B completes proposal 2, then release A. Expect exactly one awaiting intent (proposal 2) and A's result `cancelled`.
  - `database refuses two pending intents`: inserting two `awaiting_confirmation` rows for one session directly throws a unique violation.
  - `parallel proposals leave one card`: 10 concurrent `propose` calls across both pools leave exactly one awaiting intent; every other one is `cancelled` with `statusReason: "superseded"` or returned `cancelled`.
- [ ] **Step 2:** Run `pnpm vitest run packages/harness/src/coordination.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `coordination.ts`; rewrite `propose` and `cancel` in `harness.ts` to use it; generate the migration.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(harness): coordinate proposals through the database`.

### Task 4: Confirmation claims with fencing tokens

**Files:**
- Modify: `packages/db/src/schema.ts` (add `confirmClaims`, `intents.revision`), `packages/harness/src/harness.ts:141-152` (`confirm`) and `:107-139` (`refreshIfStale`), `packages/harness/src/intents/repo.ts` (`patch`, `transition`), `packages/harness/src/coordination.ts`
- Test: `packages/harness/src/coordination.test.ts`

**Interfaces:**
- Produces: table `confirm_claims(intent_id text pk, token uuid not null, expires_at timestamptz not null)`; column `intents.revision integer not null default 0`, incremented by every change to `params`, `paramsHash`, `preview` or `expiresAt`; `claimConfirmation(db: Db, intentId: string, ttlMs = 30_000): Promise<{ token: string; revision: number } | null>` (an upsert that takes over only when `expires_at < now()`, using database time; returns `null` when another live claim exists); `releaseConfirmation(db, intentId, token): Promise<void>`; `IntentRepo.patchFenced(id, expected: { token: string; revision: number }, patch): Promise<boolean>`, which updates only if the claim token is live and `revision` matches, then increments `revision`.

`confirm` replaces the `confirming` Set: on `null` it returns `{ status: candidate.status, summary: "I'm already checking that confirmation." }` (same copy as today). `refreshIfStale` writes the requote through `patchFenced`; if that returns false (cancelled, superseded, expired or revised meanwhile), throw `ArcieError("POLICY_DENIED", { spoken: "The details changed. Please check the new card and confirm again." })`. A requote returns the refreshed card and needs a fresh confirmation, as today.

- [ ] **Step 1: Write failing tests:**
  - `duplicate confirmations on two instances execute once`: voice confirm on pool A and screen confirm on pool B at the same time; `FakeAppKit.send` is called exactly once; the other call returns "I'm already checking that confirmation." or "Already on it."
  - `stale consent loses to a requote`: A's confirm triggers a requote (latched estimate), B confirms with the old revision; release. Expect zero executions and an awaiting intent with the new quote.
  - `cancel during preparation blocks execution`: A's confirm is latched inside `refreshIfStale`; B cancels; release. Expect no execution and status `cancelled`.
  - `claim expiry ignores instance clock`: claim, then call again with `ctx.now` set 10 minutes ahead. The second claim is refused because the database says the first is still live.
  - `expired claim can be taken over`: with `ttlMs = 1`, a second claim after 50 ms succeeds and the first token can no longer `patchFenced`.
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** Implement. Generate the migration.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(harness): fence confirmations across instances`.

### Task 5: Budget lock and atomic execution claim

**Files:**
- Modify: `packages/harness/src/harness.ts:172-195` (the claim transaction), `packages/harness/src/policy/db-provider.ts`, `packages/harness/src/policy/provider.ts`, `packages/harness/src/intents/repo.ts` (`spentTodayUsd`), `apps/server/src/auth/onboard.ts` (limits insert)
- Test: `packages/harness/src/budget.test.ts`

**Interfaces:**
- Consumes: Task 4's claim `{ token, revision }`.
- Produces: `claimExecution(tx: Tx, args: { intentId: string; userId: string; token: string; revision: number; channel: Channel; check: (limits: AgentLimits, spentTodayUsd: number) => void }): Promise<boolean>`. It runs `select … from arcie.users where id = $1 for update` (the per-user budget lock), re-reads limits through `PolicyProvider.getLimits(userId, tx)`, re-reads the intent, verifies status, revision, claim token and `paramsHash`, sums settled and reserved outflows with `IntentRepo(tx).spentTodayUsd`, calls `check`, and transitions to `executing`. `PolicyProvider.getLimits(userId: string, tx?: DbOrTx)`. Every limits writer (`onboard`, and any future limits route) takes the same `users … for update` lock first.

The transaction commits before `ACTIONS[kind].execute` contacts Circle (already true; keep it). Persist `txHash` immediately when returned (already true). On a thrown `UNKNOWN` / `RPC_UNAVAILABLE` / `CIRCLE_API_ERROR` keep today's `submission_unknown` path: no retry, reservation kept.

- [ ] **Step 1: Write failing tests:**
  - `separate intents share one budget`: daily limit 10 USD; two sessions of one user each propose 6 USD and confirm concurrently on two pools; exactly one executes and the other is denied with the daily-limit copy.
  - `limits change between proposal and confirm`: lower the limit below the intent value after proposing; confirm is denied.
  - `kill after submit keeps reservation`: make `FakeAppKit.send` record the call, then throw `CIRCLE_API_ERROR`; expect status `executing`, `statusReason: "submission_unknown"`, `send` called once, and a following 1 USD proposal denied if it would exceed the limit including the reserved amount.
  - `no transaction spans the network call`: while `FakeAppKit.send` is latched, a `select … for update nowait` on the user's row from another pool succeeds.
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(harness): lock the user budget for execution claims`.

### Task 6: Persisted wallet provisioning and a one-time welcome drip

**Files:**
- Modify: `packages/db/src/schema.ts` (add `walletProvisioning`, `users.welcomeDripTx`), `packages/appkit/src/wallets.ts`, `apps/server/src/auth/onboard.ts:33-50`, `apps/server/src/testkit.ts` (`fakeCircle`)
- Test: `packages/appkit/src/wallets.test.ts`, `apps/server/src/auth/onboard.test.ts`

**Interfaces:**
- Produces: table `wallet_provisioning(user_id text, chain text, idempotency_key uuid not null, status text not null check (status in ('pending','created','uncertain')), updated_at timestamptz not null default now(), primary key (user_id, chain))`; `WalletCreator.createWallets` input gains `idempotencyKey: string` (the installed SDK 10.8.1 accepts it through `WithIdempotencyKey`); `ensureWallet(db, circle, opts): Promise<WalletRef>` keeps its signature.

Algorithm: insert the provisioning row with a fresh UUID `on conflict do nothing`, then read it. Every caller, on every instance, uses the stored key, so Circle replays one creation. Insert the wallet mapping `on conflict (user_id, chain) do nothing` and mark `created`. If Circle errors, mark `uncertain` and rethrow; a later call retries with the same key, never a new one. Delete the in-process `inflight` map. Drip: claim with the existing compare-and-set; store `welcomeDripTx` on success; on any error keep `welcomeDripAt` set (never reset to null) and write an `audit` row `welcome_drip.uncertain`. Record a `Ruling:` that a failed testnet drip is never retried automatically.

- [ ] **Step 1: Write failing tests:**
  - `concurrent onboarding on two pools`: two `onboard` calls for one new user on two pools, with `fakeCircle` returning the same wallet for the same `idempotencyKey`. Expect one `wallets` row, both callers get the same address, and every `createWallets` call carries the same key.
  - `retry after Circle error reuses the key`: the first `createWallets` throws; the second call succeeds; both calls carry the same `idempotencyKey`; status `created`.
  - `failed drip is not retried`: `drip` throws; `welcomeDripAt` stays set; a second `onboard` doesn't call `drip` again; an audit row `welcome_drip.uncertain` exists.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement and generate the migration.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(wallets): persist provisioning across instances`.

### Task 7: Durable event log behind `/events`

**Files:**
- Modify: `packages/db/src/schema.ts` (add `sessionEvents`), `packages/harness/src/events.ts`, `packages/harness/src/harness.ts` (every `bus.publish`), `packages/harness/src/tools/onramp.ts`, `apps/server/src/events/sse.ts`, `apps/server/src/app.ts`, `apps/server/src/reconcile.ts`, `apps/server/src/testkit.ts`
- Test: `apps/server/src/events/sse.test.ts`, `apps/server/src/events/sse-expiry.test.ts`, `packages/harness/src/events.test.ts`

**Interfaces:**
- Consumes: Task 3's `session_state.next_event_seq`.
- Produces: table `session_events(session_id text, seq bigint, payload jsonb not null, created_at timestamptz not null default now(), primary key (session_id, seq))`; `class EventLog { append(db: DbOrTx, sessionId: string, island: IslandPayload): Promise<number>; readAfter(sessionId: string, afterSeq: number, limit = 100): Promise<{ seq: number; island: IslandPayload }[]>; snapshot(sessionId: string): Promise<{ cursor: number; islands: IslandPayload[] }>; prune(): Promise<number> }`. `append` allocates `seq` with `update session_state set next_event_seq = next_event_seq + 1 … returning` inside the caller's transaction, which serializes writers per session so a reader can never skip an event that commits late. `AppDeps.bus` becomes `AppDeps.events: EventLog`; `StepTracker` takes an `EventLog`.

Harness state changes and their islands commit in one transaction (proposal + card, transition + receipt, cancel + dismiss). SSE: on connect, `snapshot()` reads the open card (or the latest receipt) and the current max seq in one `repeatable read` transaction, then tails `readAfter` every 1000 ms. It sends `id: <seq>` on each event, honors `Last-Event-ID` (skipping the snapshot when the cursor is still retained), keeps the 15 s ping and the per-iteration `authorizeSession` recheck, and closes after `SSE_MAX_MS = 240_000` with `retry: 1000` so the browser reconnects before the 300 s function limit. Retention: 24 h, enforced by `prune()` (deletes `created_at < now() - interval '24 hours'`), called from `append` at most once a minute per instance. If `Last-Event-ID` is older than the oldest retained event, send the snapshot instead.

- [ ] **Step 1: Write failing tests:**
  - `publish on one instance reaches a stream on another`: two `testApp`s sharing one test database; open `/events` on B, propose on A; B receives the confirm island within 2 s.
  - `publication during initial connection is not lost`: append while the snapshot transaction is open (hook a latch into `snapshot`); the event arrives exactly once.
  - `resume across forced close`: with `SSE_MAX_MS = 200`, publish 50 islands during the stream; reconnect with the last received `id`; the union of both streams is exactly seq 1..50 in order.
  - `out-of-order commit is not skipped`: transaction T1 appends (seq n) and stays open while T2 appends (seq n+1) and commits; a reader polling meanwhile, then after T1 commits, receives n before n+1.
  - `stale cursor gets the snapshot`: a `Last-Event-ID` below the retained range returns the current card.
  - Keep the existing expiry tests passing: an expired session closes by the next heartbeat and no private island is sent.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement and generate the migration; delete `EventBus`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(events): durable per-session event log for SSE`.

### Task 8: On-demand reconciliation

**Files:**
- Modify: `apps/server/src/reconcile.ts`, `apps/server/src/api/intents.ts`, `apps/server/src/api/me.ts` (activity), `packages/db/src/schema.ts` (`intents.reconcileCheckedAt`)
- Test: `apps/server/src/reconcile.test.ts`

**Interfaces:**
- Consumes: Task 7's `EventLog`.
- Produces: `reconcileIntent(deps: { db: Db; kit: AppKitPort; events: EventLog }, intentId: string): Promise<boolean>` and `reconcileUser(deps, userId: string, budgetMs = 3_000): Promise<number>`. Both skip intents whose `reconcile_checked_at > now() - interval '10 seconds'`, claimed with a compare-and-set update. Remove `reconcileExecuting` and the startup call.

`GET /intents/:id` and the activity route call these before reading, and then return the current state. Keep today's outcomes: a hash and settlement → `succeeded`/`failed` with receipt; no hash after 5 minutes → `failed` with `statusReason: "submission_unknown"` and the reservation kept; `PENDING` → unchanged. The receipt event and status change commit together.

- [ ] **Step 1: Write failing tests:**
  - `reading an executing intent settles it`: an executing swap with a txHash and `waitForSwap` returning `DONE`; `GET /intents/:id` returns `succeeded` with a receipt, and the receipt event is in the log.
  - `concurrent reads check once`: 5 parallel `GET /intents/:id` calls make one `waitForSwap` call.
  - `reconciliation never resubmits`: for every reconciliation path, `FakeAppKit.send/swap/deposit` call counts stay 0.
  - Keep the existing reconcile tests (renamed to call `reconcileUser`).
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): reconcile executing intents on read`.

### Task 9: Vercel entry, Supabase connection, roles and RLS

**Files:**
- Create: `apps/server/src/runtime.ts`, `apps/server/src/local.ts`, `apps/server/vercel.json`, `apps/server/scripts/build-assets.ts`, `packages/db/drizzle/000N_roles_rls.sql` (custom migration)
- Modify: `apps/server/src/index.ts`, `apps/server/src/env.ts`, `apps/server/src/api/client-assets.ts`, `apps/server/package.json`, `.env.example`, `.gitignore`
- Test: `apps/server/src/runtime.test.ts`, `packages/db/src/roles.test.ts`

**Interfaces:**
- Produces: `createRuntime(env: Env): Promise<{ app: Hono; close(): Promise<void> }>`; `index.ts` exports `default` a Hono app that builds the runtime on its first request (memoized promise; reset on failure); `local.ts` builds it eagerly and calls `serve`. Env: `DATABASE_URL` (required, a `postgres://` URL; the pooler on port 6543 when hosted), `DATABASE_MIGRATION_URL` (used only by `pnpm db:migrate`), `DATABASE_POOL_MAX` (default `3`), `DATABASE_SSL` (`require` by default when the host isn't `localhost`/`127.0.0.1`). Scripts: `db:migrate` (`tsx --env-file=../../.env scripts/migrate.ts`), `build` (`tsx scripts/build-assets.ts`, which writes the onramp bundle to `apps/server/public/assets/onramp.js`). `client-assets.ts` serves the prebuilt file when present and falls back to the runtime esbuild bundle in dev.

`vercel.json`: `installCommand: "cd ../.. && pnpm install --frozen-lockfile"`, `buildCommand: "pnpm build"`, `functions: { "src/index.ts": { "maxDuration": 300 } }`. The Vercel project's root directory is `apps/server`. If the first preview build can't trace the workspace `.ts` packages, bundle `src/index.ts` with esbuild in `build` instead and record a `Ruling:`; don't change package exports.

The roles migration creates `arcie_runtime` (`nologin`; the hosted login role is granted it at provisioning time), grants it `usage` on schema `arcie` plus `select, insert, update, delete` on its tables and `usage` on its sequences, revokes everything on schema `arcie` from `public`, `anon` and `authenticated` (creating those two roles in tests if absent, as Supabase has them), enables RLS on every table, and adds one `for all to arcie_runtime using (true) with check (true)` policy per table. No `auth.uid()`.

- [ ] **Step 1: Write failing tests:**
  - `entry import is side-effect free`: with `DATABASE_URL` pointing at an unreachable port, `await import("./index.js")` resolves without throwing and opens no socket; the first `app.request("/health")` then fails with a 500/503, not a crash.
  - `health works through the lazy runtime`: against a test database, `GET /health` returns `{ ok: true }` and a second request reuses the same runtime.
  - `createRuntime runs no migrations`: on an empty database, `GET /health` succeeds and `to_regclass('arcie.users')` stays `null`.
  - `pooler-safe client`: `createDb` passes `prepare: false` (spy on the postgres.js factory) and `ssl: "require"` for a non-local host.
  - `browser roles are denied`: `set role anon; select * from arcie.users` and the same for `authenticated` fail with permission denied; `set role arcie_runtime` can select, insert and delete.
  - `prebuilt asset is served`: after `pnpm build`, `GET /assets/onramp.js` returns the file with `content-type` JavaScript, without invoking esbuild.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `apps/server/public/assets/` to `.gitignore`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm --filter @arcie/server build`. Expected: PASS and the asset file exists.
- [ ] **Step 5:** Commit `feat(server): Vercel entry and Supabase-ready database access`.

### Task 10: SQLite → Postgres import command

**Files:**
- Create: `apps/server/scripts/import-sqlite.ts`, `apps/server/scripts/import-sqlite.test.ts`, `packages/db/src/sqlite-schema.ts` (moved in Task 1)
- Modify: `apps/server/package.json` (`db:import-sqlite`)

**Interfaces:**
- Produces: `importSqlite(opts: { sqlitePath: string; target: Db }): Promise<{ counts: Record<string, number> }>` plus a CLI `pnpm --silent db:import-sqlite <backup.db>` that prints table names and counts only.

It opens the SQLite file read-only, refuses with `TARGET_NOT_EMPTY` if any `arcie` table has rows, copies every table in foreign-key order in one Postgres transaction while preserving ids, JSON, statuses and timestamps, sets the `audit` identity to `max(id) + 1`, initializes `session_state` for sessions that have intents (`proposal_generation = 0`, `next_event_seq = 1`), and then verifies per-table counts and that every `intents.user_id`, `wallets.user_id` and `contacts.user_id` resolves. It never reads `.env` or `recovery/` and never prints rows.

- [ ] **Step 1: Write failing tests** with a synthetic SQLite fixture built in the test from `drizzle-sqlite` migrations (two users, wallets, contacts, limits, a session, intents in every status including `executing` with `submission_unknown`, choices, 3 audit rows):
  - `imports and verifies everything`: counts match; an intent's `params`, `paramsHash`, `preview.receipt` and `createdAt` are byte-identical; a new audit insert gets id 4.
  - `refuses an occupied target`: a second import throws `TARGET_NOT_EMPTY` and changes nothing.
  - `rolls back on failure`: a fixture with a contact whose user is missing aborts with no rows written.
  - `prints no records`: capture stdout from the CLI; it contains no address, email or intent id from the fixture.
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(scripts): import a SQLite backup into Postgres`.

### Task 11: Docs, release gates and fresh review

**Files:**
- Modify: `docs/deployment.md`, `.claude/NEXT.md`, `README.md`, `docs/architecture.md`, `.env.example`
- Create: `docs/vercel-supabase-review.md`

- [ ] **Step 1:** Update `docs/deployment.md` with the exact provisioning, cutover and rollback steps the spec lists, each marked as needing approval. Update `docs/architecture.md` (replace the SQLite/EventEmitter boxes, then validate the Mermaid diagrams) and refresh test counts in `README.md` and `NEXT.md`.
- [ ] **Step 2:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 3:** Dispatch a fresh whole-branch reviewer over the migration commits with this plan's Review Focus, the spec and every `Ruling:` line. Fix findings test first and record them in `docs/vercel-supabase-review.md`.
- [ ] **Step 4:** Commit `docs: Vercel + Supabase deployment and review`.
- [ ] **Step 5 (each needs explicit user approval; do not batch):** create the Supabase project and the runtime login role; set Vercel env vars through a non-logging channel; `pnpm db:migrate` against `DATABASE_MIGRATION_URL`; deploy a preview and verify `/health`, rejected unauthenticated requests, Privy login, `POST /voice/session` extra-body propagation and an authenticated voice and tap confirmation; check that cold start plus first response fits the 15 s cascade timeout; pause local writers, take a consistent SQLite backup, `pnpm --silent db:import-sqlite`, verify; switch the ElevenLabs custom LLM URL (keep the `arcie_llm_api_key` binding, backup LLM disabled, 15 s cascade timeout).
