# Wallet Savings and Sending Animation Implementation Plan

**Goal:** Add sending feedback and a compact, working savings island.

**Architecture:** React components use existing vault and intent APIs; CSS owns motion. No backend execution changes.

**Tech Stack:** React, Tailwind, Base UI drawers, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-wallet-savings-design.md`

## Constraints and review focus

- Show the APY of the exact USDC vault submitted for review.
- Handle unavailable vaults and errors without inventing rates.
- Deposit must only propose; confirmation remains separate.
- Pending and failed sends must never show success.
- Respect reduced motion and prevent duplicate submissions.

## Work

- [x] Add behavioral UI checks for savings selection, deposit proposals, loading/failure recovery, and pending/receipt transitions.
- [x] Add `SavingsIsland.tsx` and `DepositSheet.tsx`; place above wallet tokens and proxy `/vaults` in Vite.
- [x] Add `TransactionProgress.tsx`, pending send animation and receipt success animation, plus preparation feedback.
- [x] Run focused checks, full tests, typecheck, build and diff review. Browser preview is unavailable because local browser use is disabled in Work settings.

## Verification

- `pnpm test`: 294 tests passed across 33 files, including 9 wallet interaction checks.
- `pnpm typecheck`: passed.
- `pnpm --filter @arcie/web build`: passed, with dependency browser-compatibility and bundle-size warnings.
- `git diff --check`: passed.
- Read-only request through the running Vite `/vaults` proxy: valid JSON and current USDC APYs returned.
- No live transfers or deposits were executed. Visual animation inspection remains unavailable with local browser use disabled.
