# Where Arcie stands and what to do next (in order)

_Last updated 2026-11-20: Deployment target is Vercel + Supabase._

## State
- **Repo:** https://github.com/keremeskici/arcie (default branch `main`). Branch off `main` for new work; push and merge only with the user's OK.
- **Done:** plan Tasks 1–22 (all backend tasks), covering the backend and harness, the OpenAI agent endpoint, REST + SSE, onramp, the reconciler, and Privy login. 273 tests pass in the shared checkout (including uncommitted onramp-sandbox and dev-UI work) and typecheck is clean (`pnpm test && pnpm typecheck`).
- **Live on Arc Testnet:** Circle wallets; send, swap, earn and onramp (smoke test 15/15); evals 22/22; a real agent send+confirm.
- **Progress ledger** (every decision and its reasoning): `.superpowers/sdd/2026-11-06-arcie-backend/progress.md`. It's git-ignored, so it exists only in this checkout. Read it before changing anything.
- **Final backend review done:** fresh reviewer, 17 findings fixed in one test-first pass; no deferred minors. See `docs/backend-review.md`. Concurrent UI work is outside that reviewed range and needs its own release review.
- **Secrets** live only in `.env` (git-ignored). Never print them, paste them into chat, or commit them.

## Next steps, in this order

1. ~~Task 18 (ElevenLabs voice)~~ **done 2026-11-07.** The agent authenticates through the custom LLM `api_key` secret, the backup LLM is off, and the cascade timeout is 15 s. Balance, send and voice confirm are verified with a real Arc tx (see `docs/elevenlabs.md` §5). Still to verify from the UI: the `session_id` extra-body path in `AUTH_MODE=privy`. If the quick-tunnel URL changes, update the agent's custom LLM URL.
2. **Vercel + Supabase migration (approved 2026-11-20).** Execute `.claude/plans/2026-11-20-vercel-supabase.md` (11 tasks; spec `.claude/specs/2026-11-07-vercel-supabase-design.md`). Railway/SQLite hosting is superseded. Hosted provisioning, secrets, data import and the ElevenLabs URL change each need the user's approval (`docs/deployment.md`). Keep Privy authentication or restricted ingress as a gate: the LLM secret alone doesn't protect dev REST routes.
3. ~~Task 19 (project documentation)~~ **done.** README and docs/architecture.md (two validated Mermaid diagrams).
4. ~~**Final whole-branch backend review**~~ **done 2026-11-07, before deployment.** Executing-plans Final Review covered the complete backend, with a fresh reviewer given Review Focus and all Ruling lines. All 17 findings fixed test-first; 43 backend regressions added. See `docs/backend-review.md`. Merge and push still require the user's OK; concurrent UI additions need their own review.
5. **UI phase:** first cut built 2026-11-20 in `apps/web` (Vite + React + Tailwind v4; run `pnpm dev` and `pnpm web`, open http://localhost:5173 on a phone-sized viewport). Login (Privy headless Google/Apple/email, wallet behind "More options"; demo button when `AUTH_MODE=dev`), wallet (balance, Send via `POST /intents` → confirm card, Receive QR), voice portal (ElevenLabs `agentId` + `customLlmExtraBody.session_id`, contextual update after taps), and one ActionSheet for confirm/receipt/choice islands. 21st.dev components used: Siri Orb, Drawer. Not yet verified: a real voice session on a phone (the browser pane blocks the mic), and Privy login (server ran in dev mode). Remaining items from the original UI plan:
   - Privy React login with social first and wallet behind "More options" (see `docs/privy.md`).
   - Balance and quick actions.
   - Minara-style islands rendered from `/events` (spec §9).
   - ElevenLabs React SDK with `customLlmExtraBody: { session_id }` from `POST /voice/session`, plus a contextual update after on-screen taps.
   - Switch the server to `AUTH_MODE=privy`, and run `pnpm check-token <token>` once with a real login.
6. **Possible later feature:** ENS text-record agent limits (spec §14).

## Ground rules that keep it working
- The harness is the only path that moves money. The LLM proposes; only `harness.confirm` executes (spec §8.3).
- Test first for every behaviour change, then run `pnpm test && pnpm typecheck` before each commit.
- Commits end with the project's attribution line. Branch before working on `main`.
