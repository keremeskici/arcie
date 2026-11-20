# Sandbox Checkout Implementation Plan

> Execute in the current session; the user has authorized the iframe implementation described in the preceding discussion.

**Goal:** Open a working Circle sandbox checkout from Add Money or a deposit request to Arcie.

**Architecture:** Explicit server environment presets, a complete session island, and one browser controller owning a native dialog and Circle iframe. Serve a locally bundled browser SDK with the existing Hono UI.

**Tech Stack:** TypeScript, Hono, Circle App Kit server and Onramp Kit browser, esbuild, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-onramp-sandbox-design.md`

## Constraints and review focus

- Preserve existing user edits; do not commit unrelated work.
- Test key and production environment mismatch must be rejected.
- REST plus SSE must mount only once; dismissal during async work must stay dismissed.
- Expiry, initialization failure and cancellation must allow manual retry without loops.
- Sandbox submitted with settlementExpected=false must finish waiting without claiming settlement.
- Voice opens checkout only; it never collects identity/payment data or confirms payment.

## Tasks

- [x] Add failing environment, SDK-boundary and session propagation tests; implement explicit sandbox configuration and complete sessions. Run targeted tests and typecheck.
- [x] Add behavior tests for the browser controller; implement dialog, local SDK bundle, lifecycle handling and voice-only launch instructions. Run targeted tests and check the browser capability.
- [x] Verify real sandbox session creation using the authenticated wallet, run the suite and typecheck, perform a fresh review, and document the testing steps and provider limitations. Visual iframe verification is unavailable (see below).

## Execution record

- Existing checkout is suitable and has user edits. Work stays here and remains uncommitted.
- No new approval gate: the latest user request explicitly authorizes this implementation and selects an iframe.
- Backend tests: five expected failures before implementation; targeted checks subsequently passed.
- Live sandbox session: HTTP 200, sandbox widget origin, destination equals the current user's wallet. The provider omits sessionId despite its SDK type. Preserve that omission; never pass an invented ID to the SDK.
- Live agent check: “I want to deposit money” returned the screen handoff and emitted an onramp island with sandbox session fields, without an intent/confirmation card.
- Browser visual verification is unavailable: CUA reports local browser use disabled in Work settings. UI controller lifecycle and the served JavaScript bundle were checked programmatically; no purchase/KYC flow was completed.
- Fresh review identified a stale-SSE race after overlapping close/retry. A reproduced failing test now passes with a client request ID propagated through REST and SSE. An additional test verifies omitted provider session IDs are not replaced with fake IDs.
