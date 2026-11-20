# Arcie: Backend and AI Harness Design (Arc phase)

- **Date:** 2026-11-06
- **Status:** Draft, waiting for review
- **Scope of this spec:** The backend and action harness for Arc Testnet. The UI comes in a later phase.

---

## 1. Product summary

Arcie is a very simple, voice-first money app. The home screen shows the user's balance, a few quick actions (send, receive, swap, invest, add money), and a voice portal at the bottom. The voice portal runs on ElevenLabs. Through it, an AI agent carries out financial actions for the user, and the user always gets a clear, transparent confirmation step first.

**Who it's for:** people who have never used crypto. They should never need to understand chains, gas, or token addresses.

**What success looks like for this phase:**
1. In the terminal (no voice yet), a user can say "send 5 dollars to Alice", "swap 10 USDC to euros", "put 20 dollars somewhere it earns", "what's my balance", "how do I receive money", or "add 50 dollars". The agent then produces correct, fully disclosed intents. Write actions run only after an explicit confirmation.
2. The same intents can be created and confirmed through REST, which is what the UI buttons will use, and they run through the exact same harness code.
3. ElevenLabs can use the backend as a custom LLM, end to end.
4. All of these run for real on Arc Testnet: send, swap, earn deposit and withdraw, and the onramp session (sandbox).

## 3. Scope

### In scope (this phase)
- **Chains:** the design works for any EVM chain, but only **Arc Testnet** is enabled. This follows App Kit's supported chain list: Arc supports Send, Bridge, Swap, Unified Balance, Onramp, Earn, and Borrow.
- **Actions:**
  - Balance and activity (read).
  - Receive: show the user's own address and payment info (read).
  - Send: USDC/EURC on Arc (`kit.send`).
  - Swap: USDC ↔ EURC ↔ cirBTC on Arc (`kit.swap`; on Arc Testnet, Swap only accepts these three tokens).
  - Earn ("invest"): explore vaults, deposit, withdraw, and check positions (`kit.earn`).
  - Onramp ("add money"): mint a session on the server and show the hosted widget (`kit.onramp`, sandbox).
- Custodial agent wallets: one Circle developer-controlled wallet per user per chain.
- An OpenAI-compatible custom LLM endpoint for ElevenLabs. The agent runs on OpenAI models.
- The harness: tool registry, intent lifecycle, policy, previews, confirmation, execution, and audit.
- Island payloads (Steps, Choice, Confirm, Receipt, Onramp) streamed to clients over SSE.
- Login with Privy (Google / Apple / email, wallet as a hidden option); see §17. Header/demo identity stays as `AUTH_MODE=dev` for tests and local demos.

### Out of scope (this phase)
- All UI work. That includes the island visuals: this phase defines the payloads, not how they look.
- KYC. Onramp's own KYC happens inside Circle's widget.
- Mainnet.
- Borrow and Unified Balance.

### Planned follow-on phases (this design keeps room for them)
- **ENS-based onchain agent limits** (possible feature branch). See §14.

## 4. Architecture

```
┌────────────────────────┐   custom LLM (OpenAI-compatible, SSE)
│ ElevenLabs voice agent │──────────────────────────────────────┐
└────────────────────────┘                                      │
┌────────────────────────┐   REST + SSE (/events)               ▼
│ apps/web (UI phase)    │──────────────────────────► apps/server (Hono, Node 22+)
│                        │                              ├─ llm/   /v1/chat/completions → OpenAI tool loop
└────────────────────────┘                              ├─ api/   balances, intents, confirm/cancel, onramp sessions
                                                        ├─ events/ SSE bus (island payloads per session)
                                                        └─ uses ↓
                                       packages/harness   ← the ONLY code path that can move money
                                         ├─ tools/       zod-typed registry: read | propose | control
                                         ├─ intents/     state machine, param hashing, TTL, at-most-once
                                         ├─ policy/      PolicyProvider interface (db now, ENS later)
                                         ├─ disclosure/  builds Confirm/Receipt island payloads
                                         └─ audit/
                                       packages/appkit    ← Circle App Kit wrapper, chain-parametrized
                                         ├─ chains.ts    registry: enabled chains, tokens, explorer URLs
                                         ├─ wallets.ts   Circle dev-controlled wallet provisioning
                                         ├─ ops/         send · swap · earn · onramp (+ estimates)
                                         └─ errors.ts    normalized error codes
                                       packages/db        SQLite + Drizzle
```

**Responsibilities of each unit:**
- **`packages/appkit`** knows Circle App Kit and chains, and nothing about AI or HTTP. Every operation takes `{ userWallet, chain, ...params }` and returns normalized results or `ArcieError`s. Tests replace it with a fake.
- **`packages/harness`** knows tools, intents, policy, and disclosure, and nothing about OpenAI or HTTP. It exposes `runTool(ctx, name, args)`, `confirm(ctx, intentId, channel)`, `cancel(ctx, intentId)`, and an event emitter.
- **`apps/server/llm`** translates between the chat-completions format and harness tools, and streams back only spoken text.
- **`apps/server/api`** exposes the same harness to UI buttons. A tap on "Swap" and the sentence "swap 5 USDC to euros" create the same kind of intent.
- **`apps/server/events`** handles one SSE stream per session. Every harness event becomes an island payload.

**Stack:** TypeScript, a pnpm workspace, Hono on Node 22+, Drizzle + SQLite (better-sqlite3), zod, the `openai` SDK, `@circle-fin/app-kit` + `@circle-fin/adapter-circle-wallets`, and Vitest. Local development uses ngrok so ElevenLabs can reach the server. Deployment target: Railway or Fly (to decide in Phase 5).

## 5. Chain model (EVM-compatible, Arc first)

- A **chain registry** (`packages/appkit/chains.ts`) lists the enabled chains. For each one it holds the App Kit chain id (`Arc_Testnet`), the tokens that are allowed for each capability, and the explorer URL format. It can also check which capabilities a chain supports at runtime with `kit.getSupportedChains(operation)`.
- This phase enables only `Arc_Testnet`. Adding a chain means adding a registry entry and provisioning a wallet; no harness changes.
- Tool parameters have an optional `chain` field that defaults to the user's home chain (Arc). The LLM is told to leave chains out of the conversation unless the user brings them up.
- Balances are reported per chain and as a USD-denominated total. Only Arc is active this phase.

## 6. Wallets and custody

- Every user gets a **Circle developer-controlled wallet** on each enabled chain. On Arc, it's created during user setup. On other chains, it's created lazily the first time that chain is needed. Per the App Kit docs, each dev-controlled wallet lives on one chain, so crosschain flows need one wallet per chain.
- All signing happens on the server through the `circle-wallets` App Kit adapter. App Kit operations receive `from: { adapter, chain, address }`.
- The `wallets` table stores `(userId, chain, circleWalletId, address, accountType)`.
- **To verify in Phase 1:** whether to use EOA or SCA. On Arc, gas is paid in USDC. We'll check fee handling for both types in the Phase 1 smoke test, starting with EOA because it has fewer moving parts.
- Secrets (`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `OPENAI_API_KEY`, the onramp key, …) live only on the server, in `.env`, never in a repo or client.

## 7. Agent and LLM gateway

- `POST /v1/chat/completions` is OpenAI-compatible and supports `stream: true` (SSE). ElevenLabs is configured with "custom LLM" pointing at this URL.
- On each request, the server:
  1. Resolves the `userId` and `sessionId`, from ElevenLabs extra body or dynamic variables (falling back to the demo user).
  2. Treats the incoming `messages` as the conversation. The server keeps the *authoritative* intent state itself. The model never controls intent state through the transcript.
  3. Runs an OpenAI tool loop (`OPENAI_MODEL` env var, a fast mini-class model by default for voice latency), with **at most 6 tool calls per turn**.
  4. Streams the assistant's spoken text back as soon as it's ready.
- **System prompt rules** (style, not safety; safety is enforced in code):
  - Short, warm, spoken sentences; no jargon.
  - Never read out addresses or hashes.
  - For a proposal, speak the tool's `spokenPrompt` exactly.
  - If the request is ambiguous, call a tool that returns a Choice island rather than guessing.
- **Text REPL** (`pnpm chat`): calls the same endpoint without streaming. This is the main dev loop until voice is wired up.

## 8. The harness

### 8.1 Tools given to the model

Every tool returns `{ summary: string /* voice-safe */, data: object, island?: IslandPayload }`.

| Kind | Tool | Backing |
|---|---|---|
| read | `get_balances({ chain? })` | wallet balances via App Kit / RPC |
| read | `get_receive_info({ chain? })` | the user's wallet address + Receive island (address/QR data) |
| read | `find_contact({ name })` / `list_contacts()` | db; several matches produce a Choice island |
| read | `get_swap_quote({ tokenIn, tokenOut, amountIn })` | `kit.estimateSwap` |
| read | `list_earn_vaults({ token? })` / `get_earn_positions()` | `kit.earn.exploreVaults` / position APIs |
| read | `get_activity({ limit? })` / `get_intent({ id })` | audit + intents |
| propose | `propose_send({ to, amount, token, chain? })` | `kit.estimateSend` → intent |
| propose | `propose_swap({ tokenIn, tokenOut, amountIn, maxSlippageBps?, chain? })` | `kit.estimateSwap` → intent |
| propose | `propose_earn_deposit({ vault \| "best", amount, token? })` | earn preview → intent |
| propose | `propose_earn_withdraw({ vault, amount \| "all" })` | earn preview → intent |
| action | `start_onramp({ amount?, token? })` | mints an onramp session → Onramp island (no intent; Circle's widget handles payment and KYC) |
| control | `confirm_intent({ id })` / `cancel_intent({ id })` | harness |

### 8.2 Intent lifecycle

```
propose_* ──► validating ──► rejected            (policy/validation failed; reason disclosed)
                  │
                  ▼
            awaiting_confirmation ── TTL 120s ──► expired
                  │  cancel / superseded ──► cancelled
                  ▼  confirm(channel: voice | screen)
              executing ──► succeeded (txHash, actuals)  |  failed (ArcieError)
```

### 8.3 Harness rules (enforced in code)
1. **The LLM never executes directly.** Write tools only propose. Execution goes only through `confirm`.
2. **Voice confirmation needs a new user turn.** `confirm_intent` from the LLM is refused unless there has been at least one user message *after* the preview was delivered. This stops the model from proposing and confirming in the same turn.
3. **Confirm executes exactly what was previewed.** The intent stores its normalized parameters plus `paramsHash`. Any change means a new proposal.
4. **Stale quotes are refreshed.** For swap and earn, if the quote is older than 30s at confirm time, the harness re-estimates. If the output moved by more than the slippage cap, the intent goes back to `awaiting_confirmation` with an updated Confirm island and a stated adjustment.
5. **At most once.** A compare-and-set status transition (`awaiting_confirmation → executing`) means a simultaneous voice confirm and screen tap execute only once. The loser gets `already_confirmed`.
6. **One open Confirm per session.** A new proposal supersedes any older pending intent in that session, which becomes `cancelled`, reason `superseded`.
7. **Confirmation channel policy** is configurable: `any` (default), `screen`, or `voice+screen`.
8. **Everything is audited:** tool calls, policy decisions, state transitions, App Kit calls, and tx hashes.

### 8.4 Policy
A `PolicyProvider` interface returns the user's limits. The harness checks them before producing any preview.

```ts
interface AgentLimits {
  maxPerTxUsd: number;        // e.g. 50
  dailyCapUsd: number;        // e.g. 200
  allowedActions: ActionKind[]; // send | swap | earn_deposit | earn_withdraw
  allowedTokens: string[];    // USDC, EURC, cirBTC
  maxSlippageBps: number;     // e.g. 100
  newRecipientRequiresScreen: boolean; // raw address not in contacts → screen confirm
}
interface PolicyProvider { getLimits(userId: string): Promise<AgentLimits & { source: "db" | "ens" }> }
```

- In this phase, `DbPolicyProvider` supplies the limits. ENS is a candidate later (§14).
- Other checks: balance is enough (including fees), the recipient is valid (a contact, or a checksummed address flagged as "new recipient"), and the vault is on the allowlist (from `exploreVaults`).
- Policy violations are disclosed specifically: "That's over your $50 per-transaction limit." A violation can never be overridden through conversation.

## 9. Transparency and islands (based on Minara's confirmation flow)

Reference: a recording of Minara AI. We took its **confirmation flow** and none of its perps functionality. What we took:
- a live, collapsible trace of steps in which failures stay visible;
- a plain-language disclosure (with adjustments, costs, and risks, key numbers in bold) *before* the card;
- a docked confirm card: the title is a question naming the exact action and size, chips, a key/value grid, unknowns shown as "—", and buttons with stated meanings;
- a receipt with actual values and elapsed time, plus one "Next step";
- the user can interrupt or stop at any time.

We deliberately left out Minara's "Auto mode" (execution without asking): every write needs a confirmation.

### 9.1 Island payloads
The server is the source of truth for islands and pushes them over SSE `/events?sessionId=…`. In voice mode, the client draws them as floating islands, and each one can be acted on **by voice or by tap**.

```ts
type IslandPayload =
  | { kind: "steps";   runId: string; steps: { id: string; label: string; status: "running"|"done"|"failed"; error?: string }[]; elapsedMs: number }
  | { kind: "choice";  choiceId: string; question: string; options: { id: string; label: string; detail?: string }[] }
  | { kind: "confirm"; intentId: string; title: string /* question */; chips: string[];
      rows: { label: string; value: string | null /* null → "—" */; estimate?: boolean }[];
      adjustments: string[]; risks: string[]; disclosure: RichText;
      buttons: { confirm: string; cancel: string } /* stated meanings */;
      expiresAt: string; spokenPrompt: string }
  | { kind: "receipt"; intentId: string; status: "succeeded"|"failed";
      rows: { label: string; estimated: string | null; actual: string | null }[];
      txHash?: string; explorerUrl?: string; newBalance?: string; elapsedMs: number;
      error?: { code: string; message: string }; nextStep?: { label: string; utterance: string } }
  | { kind: "onramp";  sessionToken: string; destinationAddress: string; amount?: string; token: string }
  | { kind: "receive"; address: string; chain: string; tokens: string[] };
```

### 9.2 Content rules
- **Every proposal has a disclosure:** what will happen, the amounts, the costs (fees, slippage cap), the **adjustments** (rounding, minimums, policy caps, a refreshed quote) and the **risks**.
  - Swap: price impact and the slippage cap.
  - Earn: APY is variable and not guaranteed, funds sit in a vault contract, and here is how to withdraw.
  - Send: onchain transfers can't be reversed, and whether the recipient is new.
- **No hidden unknowns.** A missing value is `null` (shown as "—") and every estimate is marked as one.
- **`spokenPrompt`** is 25 words or fewer and always ends by offering both channels: "…Say confirm, or tap the card."
- **Button meanings are fixed:** Confirm means "I've checked the details; do it now." Cancel means "Don't do this."
- **Receipts put actual and estimated side by side** and include at most one next step, e.g. after a swap to EURC: "Earn on your EURC?"
- **Failed steps stay visible,** with the friendly message from the error code.

### 9.3 Two channels, one confirmation
- A voice "confirm" (via `confirm_intent`, with the new-turn rule) and a screen tap (`POST /intents/:id/confirm`, `channel: "screen"`) both call `harness.confirm`. The first one wins (§8.3 rule 5).
- After a tap, the client tells the live ElevenLabs conversation through a contextual update ("user confirmed intent X on screen"), so the voice can narrate the receipt. *The exact ElevenLabs SDK call is to be verified in the UI phase.*
- "Stop" or "cancel", spoken or tapped at any time, cancels the current run and any pending intent in the session.

## 10. Onramp ("add money")
- `POST /onramp/sessions` mints a session with the server-side API key, using `appUserId` = our userId and `destinationAddress` = the user's Arc wallet. It passes `referrerDomain` when that's needed. Sessions are valid for 30 minutes.
- The agent tool `start_onramp` returns an Onramp island, and the client mounts the widget (`kit.onramp.mountIframe`). The widget's lifecycle events (`onDepositSubmitted`, `onDepositSettled`) are forwarded to `POST /onramp/events`, which writes them to the audit log and updates the balance.
- No intent or confirmation is needed: no money leaves the user's wallet, and Circle's widget handles payment confirmation and KYC.
- Development uses the **sandbox** environment and a sandbox key. Card, Apple Pay, and Google Pay in production need KYB, which is out of scope.

## 11. API surface (apps/server)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/chat/completions` | ElevenLabs custom LLM / REPL |
| GET | `/events?sessionId=` | SSE island stream |
| GET | `/me` | user, wallets, limits |
| GET | `/balances` | per-chain + total |
| GET | `/activity` | audit-derived history |
| POST | `/intents` | create an intent from UI buttons (`{ kind, params }`), same path as `propose_*` |
| GET | `/intents/:id` | current state + island |
| POST | `/intents/:id/confirm` | `{ channel: "screen" }` |
| POST | `/intents/:id/cancel` | |
| POST | `/choices/:id` | answer a Choice island by tap |
| POST | `/onramp/sessions` · `/onramp/events` | onramp session minting + lifecycle events |
| GET/POST | `/contacts` | demo contact book |

Identity: one `identify()` step. In `AUTH_MODE=privy` it requires a Privy bearer token (§17); in `AUTH_MODE=dev` it uses the `x-arcie-user` header or the demo user. Also `POST /auth/session` and `POST /voice/session` (§17).

## 12. Data model (SQLite / Drizzle)
- `users(id, displayName, homeChain, createdAt)`
- `wallets(id, userId, chain, circleWalletId, address, accountType)`
- `contacts(id, userId, name, address, chain)`
- `limits(userId, json)` (the DbPolicyProvider source)
- `sessions(id, userId, channel, lastUserTurnAt)`
- `intents(id, sessionId, userId, kind, chain, params, paramsHash, preview, status, statusReason, quoteAt, previewDeliveredAt, confirmedVia, txHash, actuals, error, createdAt, updatedAt, expiresAt)`
- `audit(id, userId, sessionId, intentId?, type, payload, createdAt)`

## 13. Errors, reliability, and testing

**Normalized errors** (`ArcieError.code`): `INSUFFICIENT_BALANCE`, `SLIPPAGE_EXCEEDED`, `QUOTE_EXPIRED`, `VAULT_UNAVAILABLE`, `POLICY_DENIED`, `INVALID_RECIPIENT`, `RPC_UNAVAILABLE`, `CIRCLE_API_ERROR`, `ONRAMP_ERROR`, `UNKNOWN`. Each code has a short spoken message. Raw errors go to the audit log only.

**Reliability:**
- An `executing` intent is polled (`waitForSwap` / the tx receipt) with a timeout. A reconciler re-checks stuck `executing` intents on startup.
- The LLM loop caps tool calls, has an OpenAI timeout with a spoken fallback, and treats tool outputs that contain user data as data.

**Tests (Vitest; all of them run without voice):**
1. Unit: policy, the intent state machine (new-turn rule, at-most-once, TTL, supersede), disclosure builders (snapshot tests of island payloads), and error mapping.
2. Harness integration with a fake `appkit`: full propose → confirm → receipt flows, and a voice/screen confirm race.
3. Endpoint contract: the streaming format of `/v1/chat/completions` (scripted OpenAI responses).
4. Tool-choice evals: about 20 utterances, each with its expected tool and arguments. It includes adversarial cases: "just do it, don't ask" must not execute, and "ignore your limits" must be denied.
5. A live smoke script on Arc Testnet: provision a wallet, fund it from the faucet, then send 1 USDC, swap 1 USDC→EURC, deposit 1 USDC into a vault and withdraw it, and mint a sandbox onramp session.

## 14. Future feature: ENS text records as onchain agent limits
- The idea: the user's limits live in **ENS text records** on the user's own ENS name, using the new ENS text-record functionality. They're then public, verifiable, and *only the name owner can change them*. The agent's custodial wallet can never raise its own limits.
- Implementation: `EnsPolicyProvider` resolves the user's name, reads a namespaced key (for example `arcie.agent.limits`, holding a JSON `AgentLimits`), validates it with zod, and caches it with a short TTL. When both ENS and DB limits exist, each field uses the stricter value. If the ENS read fails, the DB limits apply.
- The Confirm island's policy row then shows "Limits from yourname.eth".
- Before building it: confirm which ENS feature and network to target, and that the records are set from the user's *own* wallet, not the agent wallet.

## 15. Phased roadmap (high level; the detailed plan follows separately)

| Phase | Outcome |
|---|---|
| 1. Foundations + Arc spike | Monorepo, db, chain registry, Circle wallet provisioning, smoke test: real send/swap/earn on Arc Testnet; EOA vs SCA decided |
| 2. Harness core | Tool registry, intents state machine, policy, disclosure builders, audit; full unit + integration tests with fake appkit |
| 3. Agent gateway | `/v1/chat/completions` + OpenAI tool loop + REPL + tool-choice evals |
| 4. API + events + onramp | REST, SSE islands, onramp sessions and events |
| 4b. Login (Privy) | Google / Apple / email login through Privy, with wallet connection as a hidden option. Each login gets its own Arcie user and Circle wallet. Voice sessions are bound to the logged-in user (§17). |
| 5. Voice wiring | ElevenLabs agent config → custom LLM via ngrok/deploy; end-to-end voice demo of every action |
| 6. Project documentation | Architecture diagram and README setup guide |

## 17. Login and identity (Privy) — added 2026-11-07

**Goal:** a mobile-first, very simple sign-in. The main buttons are **Google** and **Apple** (plus email as a fallback). **Connect a wallet** is available, but sits behind a "More options" entry rather than on the first screen.

**Privy is for identity only; the money stays in the Circle wallet.**
- Privy authenticates the person. The agent still acts only through that person's **Circle developer-controlled wallet** (§6), which is created on their first login.
- Privy's embedded wallets are **turned off**, so a user never has two wallets to understand.
- A wallet connected through Privy is a *login method and an identity*. Its address is stored as `linkedWallet`. The agent never uses it. Later it can own the ENS limits (§14), since the user's own wallet should be the only thing that can raise them, and it can be a source of funds.

**Login screen (client config, built in the UI phase; exact keys checked against the Privy SDK then):**
- Login methods: Google, Apple, email, wallet.
- Social and email first; wallet in the overflow ("More options"): `appearance.showWalletLoginFirst: false` plus a login-method order that puts wallet last.
- Embedded wallet creation off.
- Mobile web first. If the app becomes Expo/React Native, Privy's Expo SDK is used and the backend contract below stays the same.

**Backend contract:**
- The client gets a Privy access token (`getAccessToken`, about 1 h, auto-refreshed) and sends `Authorization: Bearer <token>`.
- The server verifies it with `@privy-io/node` (`privy.utils().auth().verifyAccessToken`), using `PRIVY_APP_ID` and `PRIVY_APP_SECRET`, plus the optional `PRIVY_JWT_VERIFICATION_KEY` to skip the key fetch. The Arcie user id is the Privy user id (`sub`).
- An invalid or expired token gets `401 { error: { code: "UNAUTHENTICATED" } }`, and the client refreshes the token and retries.
- `POST /auth/session` (authenticated) is called right after login. It is idempotent. It:
  - creates the user if needed, using a display name from Privy and recording `linkedWallet` if a wallet was used;
  - writes the default limits;
  - creates the Circle wallet on the home chain;
  - optionally sends a small **testnet welcome drip** of USDC from the admin wallet (`WELCOME_DRIP_USDC`, once per user) so new users can try the app;
  - returns `{ user, wallet: { address, chain }, limits }`.
- **Voice sessions are bound to the user.** `POST /voice/session` (authenticated) creates an unguessable session id that's linked to the user and expires (`sessions.expiresAt`, 2 h). The client passes it to ElevenLabs as the custom-LLM extra-body `session_id`.
  - When `AUTH_MODE=privy`, `/v1/chat/completions` takes the user **only from that session row**. `user_id` in the body and the `x-arcie-user` header are ignored. An unknown or expired session gets a 401.
  - This matters because the custom-LLM request comes from ElevenLabs' servers, not from the user's device, so its body can't be trusted on its own.
- `GET /events?sessionId=…` uses the same session id. EventSource can't send headers, and the id is unguessable and bound to the user.
- All REST routes (§11) go through one `identify()` step: a Privy bearer token in `privy` mode, or the header or demo user in `dev` mode (`AUTH_MODE=dev` stays for tests, the REPL and local demos).

**Data model additions:** `users.linkedWallet`, `users.email` (nullable), `users.welcomeDripAt` (nullable); `sessions.expiresAt`.

**Out of scope:** account deletion, linking several logins to one account (Privy can handle that on the client later), and mainnet KYC.

## 16. Open questions to resolve during build
1. EOA vs SCA for dev-controlled wallets on Arc (Phase 1 spike).
2. How ElevenLabs passes `userId`/`sessionId` to a custom LLM (extra body vs dynamic variables), and the exact streaming format it expects (Phase 5; the REPL works around it until then).
3. Whether Earn deposit/withdraw has a dedicated preview method or needs to be estimated from vault data (Phase 1; per the docs, `/app-kit/tutorials/earn/preview-operations` exists).
4. The ENS network and record format for §14.
