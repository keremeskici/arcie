# Arcie: project context

A voice-first, very simple money app. It shows the user's balance and quick actions, and has an ElevenLabs voice portal. An AI agent sends, receives, swaps, invests, and onramps for the user, always behind a transparent confirmation step.

## Current focus
- **Arc Testnet only**, and **backend first** (the UI comes later).
- Design spec: `.claude/specs/2026-11-06-arcie-backend-design.md`. Read it before you change architecture or harness behavior.
- Implementation plan: `.claude/plans/2026-11-06-arcie-backend.md` (Tasks 1–22).
- **Start here in a new session: `.claude/NEXT.md`**, which has the current state and the next steps in order.
- **Deployment: Vercel + Supabase Postgres** (one Vercel project for UI, REST, SSE and the custom LLM endpoint; Supabase for the database only; Privy stays for identity). Spec: `.claude/specs/2026-11-07-vercel-supabase-design.md`; plan: `.claude/plans/2026-11-20-vercel-supabase.md`. Railway/SQLite hosting is superseded.

## Non-negotiables
- All money actions go through Circle **App Kit** (`@circle-fin/app-kit`) with the **circle-wallets** adapter (developer-controlled wallets, signed on the server).
- The LLM (OpenAI, through our OpenAI-compatible `/v1/chat/completions` endpoint, which ElevenLabs uses as a custom LLM) **never executes**. It can only propose; execution happens only through `harness.confirm`.
- Every write gets a Confirm island (voice *or* tap) with a full disclosure: amounts, costs, adjustments, risks, unknowns shown as "—".
- EVM-compatible design, but only `Arc_Testnet` is enabled. Chains come from the registry in `packages/appkit/chains.ts`.

## Docs
- Arc / App Kit docs: https://docs.arc.io (an MCP search tool is available in this environment)
- Supported chains: https://docs.arc.io/app-kit/references/supported-blockchains
