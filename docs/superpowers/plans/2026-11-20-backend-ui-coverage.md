# Backend capabilities in the wallet UI

The React wallet in apps/web is the product entry point. The server also serves an older HTML console. This inventory covers the server routes, harness tools and events, and Circle interface behind both. Existing work on savings deposits and transaction progress is the starting point.

| Capability | Starting point in React | Intended verification |
| --- | --- | --- |
| Config, onboarding, identity, session, wallet, limits | Login and wallet work. Account details and limits are hidden. | Demo login, authenticated API tests, account details, sign out |
| Balances, exchange rates and receive details | Balance, refresh, QR, copy and share exist. | Known and unknown prices, address response, copy/share outcomes |
| Contacts, lookup and choices | Send lists contacts. Creating contacts is missing. Check ambiguous-recipient choice handling. | Save and select a contact, reject invalid or duplicate entries, resolve ambiguity into review |
| Send | Review exists for two currencies. The backend also supports cirBTC and sending all. | Token selection, maximum, rejection, cancellation, confirmation and receipt |
| Quote and swap | No wallet controls. | Real quote endpoint, changed input invalidation, review, re-quote and receipt |
| Savings | The first version chose the highest USD rate and offered deposits. | Show one fixed USD savings balance, variable annual rate and earnings. Review deposits, partial withdrawals and full withdrawals. |
| Add money | The server and old console have a Circle integration. React receives checkout events without displaying them. | Button and voice launch, one iframe per session, restart, close, lifecycle events, refreshed balance |
| Activity and intent lookup | No history screen. Reopening a receipt or checking a pending request is missing. | Empty history, account-scoped events, timestamps, status, details and receipt |
| Typed chat, voice and event stream | Voice, steps and action cards exist. Typed chat and its development proxy are missing. | Session-bound multi-turn messages, tool cards, choices, REST/SSE delivery, expired and pending requests |
| Internal operations | Health check, agent callback, provisioning, reconciliation, limits enforcement, provider adapters and pricing support the product. | Exercise via server/package suites and live checks where available |

## Implementation sequence

1. Establish the current test, typecheck and runtime baseline. Inspect the live scripts before running them to identify transfers, provider credentials, session tokens or existing savings they touch.
2. Reuse the Circle browser controller. Give the wallet an Add money entry point with optional amount and currency, destination, environment and lifecycle feedback. Mount the same screen for a voice checkout. Test duplicate delivery and dismissal while a request is outstanding.
3. Complete send, swap and savings controls. Load quotes and positions from the authenticated endpoints. Pass proposals into the shared review card. Test all four actions from preparation through cancellation or receipt. Never submit a transfer from a quote or a form.
4. Add contacts, account limits, activity, intent detail and typed conversation to the wallet. Connect the missing proxy paths. Check error recovery and that action cards appear over conversations.
5. Exercise the complete React app against the real HTTP routes, database, policy and harness with deterministic provider fixtures. Cover confirmation, rejection, re-quote, expiry, duplicate delivery and provider errors at the layer that owns them.
6. Run the complete repository suite, both TypeScript checks and the web production build. Verify the running UI and exercise configured external services on Arc Testnet and Circle sandbox. Limit live withdrawals to test deposits. Record exactly which external interactions were observed and which require a person, credentials or a working provider.

## Verification on November 20, 2026

The complete repository suite passed 349 tests in 40 files. Both TypeScript checks and the production web build passed. Vite reported a bundle-size warning. The React integration tests use real application routes, SQLite, spending policy and the transaction harness. They substitute external providers to exercise failures and delayed responses reliably.

| Live test in the React wallet | Observed result |
| --- | --- |
| Send | Sent 0.01 testnet USDC to the provisioned recipient. [Arc receipt](https://testnet.arcscan.app/tx/0x8586c580f1be9d4c5af340145d561683dfdbe215236f04c774d05be29f1ced18) |
| Swap | Swapped 1 testnet USDC for 1.421214 EURC. [Arc receipt](https://testnet.arcscan.app/tx/0xf2880850eb60cf15a0051b5e93b0705e23e9aba9f4aa3110a1d550a96480a0de) |
| Savings deposit | Deposited 1 testnet USDC into EarnKit. [Arc receipt](https://testnet.arcscan.app/tx/0xb72155a6e04bac4746d853af8d05ccd126e610aa2b6124126fbe807a1b3d5bfc) |
| Savings withdrawal | Withdrew the 1 testnet USDC deposited for this run. [Arc receipt](https://testnet.arcscan.app/tx/0x41d9cdac5c3338952583955c9a292bd22002a300135029f0dc14e2a6aec4cd07) |
| Circle checkout | Chrome mounted the hosted sandbox for the demo wallet, displayed USDC on Arc, and reached the identity and terms screen with a sandbox phone challenge. The test stopped before accepting terms. Submission, settlement, failure, retry and balance refresh were exercised with SDK events locally. The hosted sandbox emits submission only. [Circle sandbox behavior](https://docs.arc.io/app-kit/references/onramp-hosting-requirements#testing-behavior) |
| Login | Demo sign-in and sign-out passed. A separate local server in Privy mode rejected anonymous wallet reads, and Chrome loaded the configured Privy SDK, email form and wallet picker. Authenticated onboarding, OTP completion and OAuth handoff were tested with provider doubles. Completing a live sign-in requires a user identity. |
| Voice | ElevenLabs connected in Chrome with synthetic microphone input. Listening, mute, unmute and end worked. |
| Typed chat and model replies | The wallet sent an authenticated conversation and rendered the service's fallback reply. OpenAI rejected the configured key with HTTP 401 and `expired_secret_key`. The live model evaluation scored 2/25, both cases that expected no tool call. Successful conversation and tool-card behavior passed with a deterministic agent. A working key is required to verify live model replies. |

Each recorded money action was proposed and confirmed from the wallet. The receipt shown by the UI, the durable intent record, and the Arc RPC transaction receipt agreed. The live run used the existing demo wallet on Arc Testnet. No new deployment was required.

After the wallet simplification, all 368 tests across 43 files passed, along with TypeScript checks and the production build. The revised home screen was checked in Chrome at 320, 390 and 768 pixels wide. Voice stayed reachable while scrolling. Contacts and Activity opened from their adjacent icons. Opening voice and returning preserved send and chat drafts. The live service prepared a $0.10 deposit, a $0.10 withdrawal and a full withdrawal from the same savings balance. All three reviews were cancelled. The direct browser console also displayed the single balance and prepared a deposit and withdrawal for review. ElevenLabs connected with a silent test microphone and responded to mute and end. The OpenAI credential still returned HTTP 401 when checking the configured model.

### Test coverage by entry point

For the updated payment screens, Chrome opened Circle's hosted sandbox from the $25 preset and fetched live swap estimates. A separate in-memory wallet refreshed its quotes 500 ms apart, submitted the displayed minimum with one tap and received its settlement receipt. The live send form displayed the numeric balance before recipient selection, calculated the available amount after selecting a contact and produced a review that was cancelled. Browser checks covered both currency selectors and the full send address at 320 pixels wide.

- `apps/web/tests/wallet-flows.test.tsx` covers wallet navigation, session renewal, ambiguous sends, chat history, receipt follow-ups and re-quote approval.
- `apps/web/tests/onramp-sheet.test.tsx` covers button and voice checkout, deduplication, lifecycle events, retry and closing during a pending request.
- `apps/web/tests/exchange-savings.test.tsx` and `apps/web/src/components/wallet-actions.test.tsx` cover send, swap, the single savings balance, earnings, deposits, withdrawals, reviews, receipts and concurrent refreshes.
- `apps/server/src/api/screen-swap.test.ts` checks repeated submissions, simultaneous requests, spending limits, changing prices, settlement and recovery. `apps/server/src/api/send-max.test.ts` checks the spendable amount shown for Send all.
- `apps/web/tests/voice-access.test.tsx` covers switching between voice, forms, chat and transaction reviews while preserving drafts and keyboard focus.
- `apps/web/tests/account-sheets.test.tsx` covers account limits, contacts and activity, including cross-session, expired and failed intents.
- `apps/web/tests/login-voice.test.tsx` and `apps/web/tests/receive-sheet.test.tsx` cover authentication, voice controls, receive QR, copy, share and recovery from device or network errors.
- The server and package suites exercise authentication, onboarding and drip, session-scoped events, pricing, Circle adapters, policy, confirmation, reconciliation and audit history.

Run `pnpm test`, `pnpm typecheck` and `pnpm --filter @arcie/web build` for the local checks. Run `pnpm evals` with a valid OpenAI credential for the live model check.
