# Vercel and Supabase migration review

The fresh whole-branch review is **pending**. Its scope starts after `83951e7`, the migration branch's rebased baseline. Record the exact reviewed head, reviewer verdict, findings, test-first fixes, and re-review results here before release. Give the reviewer the [specification](../.claude/specs/2026-11-07-vercel-supabase-design.md), the [implementation plan and Review Focus](../.claude/plans/2026-11-20-vercel-supabase.md#review-focus), and all rulings in the local migration ledger.

## Review focus

- Interruption between Circle accepting a submission and Arcie persisting its hash keeps the budget reserved. Reconciliation can mark the submission uncertain and never resubmits it.
- SSE resumes in sequence without gaps or duplicates across a duration-capped reconnect during a burst.
- Confirmation claim expiry and event retention use the database clock across instances.
- Concurrent first logins for one user on two instances produce one Circle wallet and mapping.
- Importing the Vercel entry has no database side effects. Runtime starts on the first request and migrations are explicit.

## Local evidence

- On Node 24.10.0 and pnpm 9.15.0, `pnpm test && pnpm typecheck` passed against isolated embedded Postgres. All 386 tests passed across 37 suites, and both the workspace and web typechecks passed. Two repeat runs hit the existing five-second Vercel subprocess test timeout. The prior importer task recorded the same intermittent timeout.
- The runtime task's scoped re-review cleared the local Services startup failure, database endpoint validation, and restrictions on a pre-existing runtime role. Native Vercel CLI 66.5.0 served both services in a synthetic loopback environment. The onramp asset matched its prebuilt file, protected requests were rejected, and the migration command succeeded twice with an injected owner connection.
- The importer task's scoped re-review cleared supported Node entry behavior, count-only CLI output, and rejection of extra and foreign tables. The importer used isolated Postgres and synthetic SQLite, including occupancy and rollback checks.
- The [original backend review](backend-review.md) records its historical scope and findings.

## Open release evidence

Whole-branch findings and disposition are pending. Hosted routing, restricted login and TLS, rehearsal verification, cutover, and the URL switch have their own [deployment gates](deployment.md). Record completed gates against the tested commit and environment.
