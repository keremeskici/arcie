# Vercel and Supabase migration review

The independent whole-branch review covered `83951e7..40be7db`. It found two critical and seven important issues and required changes before authenticated Preview. The consolidated fix addresses all nine findings. Independent re-review of the fix is pending. The review covered the approved specification, the plan's five scenarios and the implementation rulings. [Specification](../.claude/specs/2026-11-07-vercel-supabase-design.md) · [Review Focus](../.claude/plans/2026-11-20-vercel-supabase.md#review-focus)

## Whole-branch findings

| Finding | Implemented change and local evidence |
| --- | --- |
| C1 · Tap consent | Confirm cards carry their durable revision. Stale taps and unversioned taps on replacement or legacy cards redisplay the current disclosure. Both screen clients send its revision. |
| C2 · Interrupted model turns | Voice and typed requests advance the same session counter atomically. Duplicate and shorter histories skip the agent. Proposal publication, cancellation, choice updates and the execution claim validate the admitted turn under lock. Two independent apps exercised stale work. |
| I1 · Settlement | Recovery requires a matching swap result or Arc receipt. Unknown outcomes keep their reservation. Hash and settlement updates check the observed state. Terminal receipts, events and audits commit together. Late confirmations read the winning result. Tests exercised all three late swap outcomes, non-swap reverts and a hash arriving during an orphan check. |
| I2 · Screen capabilities | The implicit screen session is bound to its verified owner. Explicit hosted session IDs require a live, issued capability belonging to that owner. Tests cover expiry and competing identities. |
| I3 · Time and limits | Confirmation checks the database wall clock after conflicting locks, then enforces the current budget and new-recipient tap requirement. Tests move claim and card expiry across a real Postgres lock wait. |
| I4 · Web recovery | The packaged web client reads intent status with bounded backoff, tracks voice activity after reconnection, and resolves interrupted submissions before enabling a fresh tap. A changed disclosure resets the confirmation control. |
| I5 · Diagnostics | Hosted request and stream errors use fixed operation labels. Optional voice diagnostics emit a message count. Tool and drip failure audits use safe codes. Synthetic private details exercised these paths. |
| I6 · SSE lifetime | Full batches observe the stream deadline between writes. A slow consumer reconnects into a 110-event burst at its last written cursor and receives every remaining event in order. |
| I7 · Welcome drip | Onboarding stores the submitted hash before receipt polling. Reverted and uncertain outcomes keep the one-time claim. The local tests use a synthetic sender and receipt. |


## Review focus

- Interruption between Circle accepting a submission and Arcie persisting its hash keeps the budget reserved. Reconciliation can mark the submission uncertain and never resubmits it.
- SSE resumes in sequence without gaps or duplicates across a duration-capped reconnect during a burst.
- Confirmation claim expiry and event retention use the database clock across instances.
- Concurrent first logins for one user on two instances produce one Circle wallet and mapping.
- Importing the Vercel entry has no database side effects. Runtime starts on the first request and migrations are explicit.

## Local evidence

- On Node 24.10.0 and pnpm 9.15.0, `pnpm test && pnpm typecheck` passed against isolated embedded Postgres. All 410 tests passed across 39 suites, and both the workspace and web typechecks passed. The final run used three workers. Earlier baseline runs recorded an intermittent five-second timeout in the Vercel subprocess test.
- A production web build ran in headless Chrome against synthetic loopback responses. Two taps sent the displayed revisions in order. The second response was interrupted, the client read the pending state, and the recovered receipt appeared without a third submission.
- The runtime task's scoped re-review cleared the local Services startup failure, database endpoint validation, and restrictions on a pre-existing runtime role. Native Vercel CLI 66.5.0 served both services in a synthetic loopback environment. The onramp asset matched its prebuilt file, protected requests were rejected, and the migration command succeeded twice with an injected owner connection.
- The importer task's scoped re-review cleared supported Node entry behavior, count-only CLI output, and rejection of extra and foreign tables. The importer used isolated Postgres and synthetic SQLite, including occupancy and rollback checks.
- The [original backend review](backend-review.md) records its historical scope and findings.

## Open release evidence

The independent fix re-review and environment-specific checks remain separate. Hosted routing, restricted login and TLS, rehearsal verification, cutover, and the URL switch have their own [deployment gates](deployment.md). Record completed gates against the tested commit and environment.
