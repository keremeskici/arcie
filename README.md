# Arcie

**A voice-first money app on Arc.** Say *"send five bucks to Bob"*, *"swap 10 dollars to euros"* or *"put 20 dollars somewhere it earns"*. Arcie reads back exactly what will happen, including amounts, fees and risks, and nothing moves until you confirm by voice or with a tap.

## What it does

| You say / tap | What happens | Circle tool |
|---|---|---|
| "What's my balance?" | Reads your Arc wallet | Circle Wallets + Arc RPC |
| "How do I get paid?" | Shows your address on screen (never read aloud) | Circle Wallets |
| "Send 5 dollars to Bob" | Confirm card → send on Arc | App Kit `send` |
| "Swap 10 dollars to euros" | Quote, slippage cap, confirm card → swap | App Kit `swap` |
| "Invest 20 dollars" | Best-APY vault, variable-APY warning, confirm → deposit | App Kit `earn` |
| "Take it out" | Withdraw from the vault | App Kit `earn` |
| "Add 50 dollars" | Circle's hosted buy widget (card / Apple Pay / bank) | App Kit `onramp` |

Every user gets their own **Circle developer-controlled wallet** on Arc Testnet, created at first login (Google / Apple / email via **Privy**). USDC is the gas token, so there's nothing else to fund.

## Why you can trust the AI with money

The model (OpenAI, behind ElevenLabs voice) can only **propose**. A deterministic harness owns execution:

- **Confirm cards** (inspired by Minara) show the action as a question, amounts, fees ("—" when unknown), any adjustments ("0.01 USDC stays behind for the network fee"), risks, and what each button means.
- **A spoken "yes" counts only on a new user turn**, so the model can't confirm its own proposal.
- **What you confirmed is exactly what runs** (the parameters are hashed). A swap quote older than 30 s is re-checked, and you're asked again if the price moved past your slippage cap.
- **At most once:** a voice "yes" and a screen tap at the same moment execute once.
- **Limits** are checked before a card even appears: $50 per transaction and $200 per day by default, allowed actions and tokens, a slippage cap, and new recipients must be confirmed by tap.
- **Everything is audited**, and receipts show estimated vs actual values.

See `docs/architecture.md` for the diagrams.

## Repo layout

```
packages/core      shared types, money math (bigint, no floats), error codes, island payloads
packages/db        Postgres + Drizzle schema, migrations, demo seed
packages/appkit    Circle App Kit wrapper (send/swap/earn/onramp), chain registry, wallet provisioning
packages/harness   tools, intents state machine, policy, disclosure (confirm/receipt), audit, events
apps/server        Hono server: OpenAI-compatible /v1/chat/completions (ElevenLabs custom LLM), REST, SSE, Privy auth
docs/              architecture, ElevenLabs and Privy setup
.claude/           design spec, implementation plan, NEXT.md (what to do next)
```

## Run it

Requirements: Node 24, pnpm 9, and a local Postgres database for the app.

```bash
pnpm install
cp .env.example .env
```

Create an empty local Postgres database, configure `DATABASE_URL` and `DATABASE_MIGRATION_URL` in `.env`, and apply the schema from the repository root. Supply the Circle API key, onramp key, OpenAI key, `OPENAI_MODEL=gpt-5.4-mini`, `OPENAI_REASONING_EFFORT=none`, and optionally `ARC_RPC_URL`.

```bash
pnpm db:migrate
```

Then register a Circle entity secret (one time; it writes the secret to `.env` and the recovery file to `./recovery/`):

```bash
pnpm --filter @arcie/server register-entity-secret
```

Create the wallet set and the demo wallets. With `--fund`, it also sends that much USDC from `ADMIN_PRIVATE_KEY` to the demo wallet:

```bash
pnpm provision --fund 10
```

Start the server on http://localhost:8787:

```bash
pnpm dev
```

Talk to the agent from the terminal (in a second terminal):

```bash
pnpm chat
```

Run the checks from the repository root. Integration tests start an isolated embedded Postgres instance by default.

```bash
pnpm test && pnpm typecheck
```

Live Arc Testnet run of every App Kit operation:

```bash
pnpm smoke
```

Tool-choice evals against the real model (needs ≥ 90% to pass):

```bash
pnpm evals
```

Voice: see `docs/elevenlabs.md`. Login: see `docs/privy.md` (`AUTH_MODE=dev` uses the demo user; `AUTH_MODE=privy` requires real logins).

Onramp sandbox: open **Add Money → Open checkout**, or say **“I want to deposit money”** to open Circle's iframe. Follow the [sandbox testing guide](docs/onramp-sandbox.md); checkout uses test details and voice only opens the screen.

## Status

- **Arc Testnet:** the original backend smoke run passed 15/15, evals passed 22/22, and the backend review covered 206 passing tests. Balance, send, and a voice confirmation were verified with a real Arc transaction.
- **Vercel and Supabase branch:** 386 tests across 37 suites and both typechecks pass. See the [deployment runbook](docs/deployment.md) for hosted verification and cutover, and [NEXT.md](.claude/NEXT.md) for project history.
- **Possible later feature:** ENS text-record agent limits.
