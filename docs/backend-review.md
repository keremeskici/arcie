# Backend final review — 7 November 2026

The executing-plans Final Review reviewed the complete backend with a fresh reviewer (`gpt-6-astra`, high reasoning). The reviewer received the plan, spec, all five Review Focus items verbatim, and the decision ledger's Ruling lines. The baseline was 206 passing tests and a clean type check.

One test-first fix pass addressed all 17 findings. Every fix had a regression that failed before implementation; no second reviewer was dispatched. The shared checkout now passes 256 tests and `pnpm typecheck`, including seven tests added by the concurrent UI session. This pass added 43 backend regressions.

| Finding | Change | Regression coverage |
| --- | --- | --- |
| F1 · Critical | Check current policy and reserve spending atomically when claiming execution; pending/uncertain outflows retain reservations. | Sequential and concurrent confirmations across sessions, pending settlement, tightened limits. |
| F2 · Critical | Hash the approved swap minimum and pass it to Circle App Kit as `config.stopLimit`. | Immediate adverse market change; actual adapter argument boundary. |
| F3 · Critical | Persist the transaction hash before polling; a timeout remains pending. Uncertain submissions do not invite retries. | Hash visible during polling; timeout preserves state; duplicate confirmation refused; uncertain budget reserved. |
| F4 · Critical | Bind explicit confirm/cancel IDs to the originating session. | A second session cannot execute or cancel the first session's request. |
| F5 · Critical | Allow one in-flight confirmation per intent and recheck state after quote refresh. | Overlapping confirmations and cancellation while a quote is delayed. |
| F6 · Important | Propagate interruption to the harness and invalidate obsolete preparations. | Abort, cancel, and a newer proposal while an older estimate is delayed. |
| F7 · Important | Use the same schemas and defaults for REST and tool proposals. | Omitted defaults, numeric amounts, unsupported tokens, invalid slippage. |
| F8 · Important | Project activity into public summaries; keep provider diagnostics internal. | A synthetic private provider message never appears in returned activity or intent responses. |
| F9 · Important | Check both acquired and spent swap tokens against policy. | Forbidden output before proposal and after policy changes. |
| F10 · Important | Require exact checksums on raw recipient/contact addresses. | Lowercase, incorrect mixed-case, and valid checksummed addresses. |
| F11 · Important | Persist terminal receipts; record recovery activity and replay the latest receipt. | Recovery before any client connects, later REST/SSE retrieval, normal confirmation retrieval. |
| F12 · Important | Keep unknown actual swap output null. | Completed recovery without a reported output amount. |
| F13 · Important | Return an unknown total when any held asset lacks a valuation. | Nonzero cirBTC without a rate. |
| F14 · Important | Preserve fee currencies; mixed-currency speech refers to the card. | Mixed currencies, EURC-only fees, and unknown fee token. |
| F15 · Important | Check withdrawal gas in the wallet independently of the vault balance. | USDC/EURC vaults with no gas; full withdrawal with exactly enough gas and lowered spending limits. |
| F16 · Important | Revalidate event-stream credentials before islands and on heartbeats. | Expiry during an active or idle connection. |
| F17 · Important | Require the admin key only when funding; fail before provisioning if required funding credentials are absent. | Unfunded provisioning without a key; funding failure before external mutations. |

## Decisions and remaining limits

- Deployment stays at one process and one replica. The confirmation lock, event bus and wallet provisioning deduplication are local to that process. Scaling requires further design.
- Startup-only swap reconciliation and swap-only quote refresh remain as previously ruled. Slow pending swaps may wait for a restart to receive a receipt.
- Ambiguous submissions keep their spending reservation until reconciliation or operator resolution. That can conservatively block further spending even when a network failure happened before submission.
- A transaction already submitted cannot be reversed by cancel. Cancellation stops work before the execution claim and suppresses obsolete proposals.
- Non-swap recovery continues to trust the installed SDK's confirmed send/earn hash contract.
- Terminal receipts are stored alongside the original disclosure in the existing JSON column; SSE replays the latest receipt when no confirmation is pending. Older receipts remain available through intent retrieval.
- `/balances.totalUsd` is now `null` if any held asset lacks a price; `knownSubtotalUsd` gives only the priced portion. Clients must show an unknown total, not coerce null to zero.
- `/activity` no longer exposes the undocumented raw `detail` payload. Use the intent endpoint for transaction details.
- Expired idle SSE connections close by the next 15-second heartbeat; no private island is sent after expiry.
- Raw addresses must include their correct checksum. Existing stored contacts retain their established address mapping.
- Public deployment must use Privy authentication or deliberately restricted demo ingress. The custom LLM secret does not protect development REST routes.
- The real Privy login → voice-session → ElevenLabs extra-body path remains to be verified from the UI. This review used synthetic credentials and local fakes, without new live financial actions.
- UI continuation, combined voice-and-screen confirmation, mainnet, other chains and ENS remain outside this phase.
- The existing ElevenLabs API-key secret, disabled backup model and 15-second cascade timeout remain unchanged.

There are no deferred minor findings. The ignored decision ledger is preserved at `.superpowers/sdd/2026-11-06-arcie-backend/progress.md` as requested.

Concurrent UI routes and wireframe changes were added to the shared checkout during this pass with the user's approval. They were preserved and excluded from these commits, including selective staging where both sessions touched `api/me.ts`. Those UI additions were not part of the fresh backend review and need their own release review.

Nothing was merged, pushed or deployed by this review session. See [the deployment proposal](deployment.md) before authorizing the next step.
