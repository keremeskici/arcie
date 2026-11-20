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
packages/db        SQLite + Drizzle schema, migrations, demo seed
packages/appkit    Circle App Kit wrapper (send/swap/earn/onramp), chain registry, wallet provisioning
packages/harness   tools, intents state machine, policy, disclosure (confirm/receipt), audit, events
apps/server        Hono server: OpenAI-compatible /v1/chat/completions (ElevenLabs custom LLM), REST, SSE, Privy auth
docs/              architecture, ElevenLabs and Privy setup
.claude/           design spec, implementation plan, NEXT.md (what to do next)
```

## Run it

Requirements: Node 22+, pnpm 9.

```bash
pnpm install
cp .env.example .env
```

Fill in `.env`: Circle API key, onramp key, OpenAI key, `OPENAI_MODEL=gpt-5.4-mini`, `OPENAI_REASONING_EFFORT=none`, and optionally `ARC_RPC_URL`. Then register a Circle entity secret (one time; it writes the secret to `.env` and the recovery file to `./recovery/`):

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

Checks:

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

- **Backend complete:** all actions live on Arc Testnet (smoke test 15/15), evals 22/22, 206 tests. Verified by voice: balance, send, and a voice confirm with a real Arc transaction.
- **Next:** Vercel + Supabase migration and deploy (`docs/deployment.md`), UI (Privy login, islands, ElevenLabs React SDK). See `.claude/NEXT.md`.
- **Possible later feature:** ENS text-record agent limits.
