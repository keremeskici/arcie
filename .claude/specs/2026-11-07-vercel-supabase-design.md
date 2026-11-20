# Arcie: one Vercel project with Supabase Postgres

Date: 2026-11-07
Status: **approved by the user on 2026-11-20** as the deployment target, replacing Railway/SQLite. Implementation plan: `.claude/plans/2026-11-20-vercel-supabase.md`. Hosted provisioning, secrets, data transfer and the ElevenLabs URL change still need explicit approval at each step.

## Intent and scope

Use one Vercel project for Arcie's UI, REST API, island stream, and ElevenLabs custom LLM endpoint. Use one Supabase project for durable Postgres storage. Railway and a persistent local disk are unnecessary with this architecture.

The user selected Vercel plus Supabase as the hosting direction. Keeping Privy for identity and using Supabase only for the database is the implementer's recommendation, not an instruction to replace authentication. Circle App Kit remains the only money execution provider. Arc Testnet remains the only enabled chain. All writes continue through the existing confirmation harness.

This is an architecture migration, not a hosting configuration change. Preserve the reviewed payment safeguards and existing API contracts. The concurrent UI work stays in its current files and requires separate release verification. There is currently no `apps/web` directory; deployment packaging must accommodate the existing Hono-served UI and, when available, the standalone frontend without requiring a second Vercel project.

## Approaches

1. **Recommended: Vercel + Supabase Postgres, retaining Privy and Hono.** Keeps the working identity, wallet, and voice contracts. Requires asynchronous database access, shared coordination, and durable event delivery.
2. **Supabase Postgres plus Supabase Auth and direct browser subscriptions.** Also possible, but introduces an identity migration, wallet ownership mapping changes, and a second authorization design. Those changes do not advance the user's stated hosting goal, so they are excluded from this proposal.

The earlier Railway/SQLite proposal remains the existing implementation baseline until the migration is approved and built. Its single-process assumptions do not apply to the proposed Vercel runtime.

## Application and database

- Export a Hono application for Vercel's Node runtime; keep the local listening entry point separate. Preserve `/v1/chat/completions`, REST routes, `/events`, and existing UI routes. Static assets belong in the Vercel build output. If the standalone frontend becomes a separate package, use Vercel Services to package it and Hono in the same project.
- Replace SQLite runtime queries with Drizzle's Postgres dialect and asynchronous operations throughout the repository, harness, routes, auth, reconciliation, and scripts. Use Postgres for local integration tests too; do not validate Postgres concurrency with SQLite or mocked transactions.
- Connect through Supabase's transaction pooler for hosted requests, with a small connection pool, verified TLS, and prepared statements disabled where required by the pooler. Use a dedicated migration connection and run migrations explicitly, never on function startup.
- Preserve user IDs, wallet IDs and addresses, contacts, limits, sessions, choices, intent parameters/hashes, receipts, audit IDs, and uncertainty markers. Keep amount strings exact, JSON structured, and API timestamp formats compatible.
- Use a private, unexposed application schema. Revoke access from browser roles; no database secret goes to the client. Retain server-side Privy verification and ownership/session checks. Enable RLS as defense in depth, with explicit grants/policies for a restricted backend role. Keep migration ownership separate from runtime privileges. No `auth.uid()` assumption is appropriate for existing Privy text IDs. Verify denial using the actual browser roles and runtime role in tests.

## Shared payment coordination

1. Replace the process-local proposal generation map with a persisted generation per session. Starting another proposal or cancelling increments it. Publishing the choice or intent checks the same generation atomically, so delayed work cannot revive a cancelled card. Serialize supersession and insertion, with a database constraint enforcing one pending intent per session.
2. Replace the confirmation Set with a database-backed, expiring preparation claim and a fencing token. Competing confirmations return promptly rather than queue consent. Every quote update and execution claim checks the claim token and expected intent revision. Cancellation, supersession, expiry, or a changed revision prevents execution by the old request. A refreshed disclosure requires fresh confirmation.
3. In a short transaction, lock the user's budget row, re-read current limits and intent state, sum settled and reserved outflows, validate the exact approved parameters, and atomically claim execution. Different intents for the same user must contend on this same lock. All limits writers follow the same protocol. Do not keep a database transaction open across Circle/OpenAI network calls.
4. Commit the execution claim before contacting Circle. Retain transaction hashes immediately when known. Do not retry an ambiguous submission or release its budget reservation on a function timeout. Recovery observes settlement; it never resubmits a money action. Database retries apply only to transactions with no external side effects.
5. Persist wallet-provisioning ownership and its operation identity per user/chain. Verify the installed Circle SDK/API idempotency support before implementing retry behavior. Reuse a supported persisted idempotency key for retries; if outcome cannot be established safely, keep provisioning uncertain for reconciliation instead of creating another wallet. Retain unique wallet mappings and the one-time welcome-drip claim; ambiguous drip outcomes must not reset into an automatic second payment.

## Live updates and recovery

Use a private Postgres event log behind the existing SSE endpoint. This avoids introducing browser Supabase authentication. Persist session-scoped islands and their ordered sequence; commit important state changes and their corresponding events together. Allocate sequences under a session lock so readers cannot skip an event that commits out of order.

Each SSE connection reads committed events in order and polls at a short bounded interval (initial target one second), with the existing heartbeat and authorization rechecks. Use resumable event IDs, bounded batches, reconnects before the function duration limit, and cleanup on abort. A first connection obtains its current card/receipt snapshot and cursor consistently, then tails newer events. Test publication from one server instance to a stream on another and publication during initial connection. Session-scoped sensitive payloads are never exposed through Supabase's public Data API; expire event data after the session's retention window. On reconnect beyond retention, return the current snapshot.

Reconciliation no longer depends on process startup. Trigger a bounded, deduplicated settlement check when an authenticated client requests an executing intent or activity, then return its current state. The UI refreshes executing intents until terminal. An authenticated scheduled sweep can be added at deployment if the chosen Vercel plan supports the required frequency, but is not necessary for the first release. Preserve unknown actuals as unknown and uncertain spending reservations until evidence resolves them.

## Data migration and cutover

Build and test an explicit import command using synthetic SQLite fixtures first. It reads a consistent SQLite backup, imports transactionally into an empty target, preserves IDs/JSON/status, resets sequence counters correctly, and verifies counts and relationships without printing records. It refuses to overwrite an occupied target. Never read or print `.env` or `recovery` files, and never commit a database or exported records.

Actual hosted provisioning, credentials, migrations, data transfer, publication, and voice URL changes wait for user approval. At cutover, pause old writers, take a consistent backup, import and verify, then enable the new runtime as the only writer. Do not run local SQLite and hosted Postgres as competing sources of truth. After any hosted writes, rollback must preserve those writes; pointing the old server at its stale SQLite copy is not a rollback strategy.

Keep the ElevenLabs custom LLM secret binding, disabled backup, and 15-second cascade timeout. Change only the approved endpoint URL after verifying Privy login, voice session extra-body propagation, and authenticated voice/tap confirmations through Vercel. Cold-start and first-response latency must fit the existing timeout.

## Verification and release criteria

Write failing tests first for every behavior change. Required coverage includes real Postgres multi-connection races for duplicate confirmations, separate intents sharing a budget, quote refresh versus stale consent, cancellation during preparation, concurrent onboarding, and receipt/event recovery after a simulated function interruption. Keep all existing reviewed regressions passing.

Verify authorization and session expiry on every public path, browser-role database denial, migration repeat/refusal behavior, cross-instance SSE replay and ordering, and Hono routing/streaming in a local Vercel build. A live Supabase connection test and Privy/ElevenLabs end-to-end checks remain hosted release gates, not claims that local tests can establish.

Work on a feature branch off `main`, preserve concurrent UI edits, and run `pnpm test && pnpm typecheck` before every commit. Record all implementation judgment calls as Ruling lines. This architecture change needs its own fresh review before deployment; the earlier completed backend review cannot certify code that did not yet exist. No push, merge, or deploy without the user's approval.

## Sources checked

- [Hono on Vercel, including frontend packaging and streaming](https://vercel.com/docs/frameworks/backend/hono)
- [Vercel Services: multiple components in one project](https://vercel.com/docs/services)
- [Supabase connection selection](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase with Drizzle](https://supabase.com/docs/guides/database/drizzle)
- [Supabase Data API access and RLS](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase changelog](https://supabase.com/changelog): current CLI targeting changes and database/TLS updates reviewed; inspect the installed CLI's help before using it.
