# Sandbox checkout

The user approved implementing Circle's sandbox UI in the existing app. Voice only opens the iframe when the user asks to deposit; all identity and payment interaction happens on screen.

Use a native dialog containing Circle's SDK-mounted iframe. Reuse the existing Add Money route and SSE island for both entry points. A popup was considered but requires a click and adds no value to the requested voice-triggered iframe. Keep the current checkout and preserve existing uncommitted changes.

Default onramp to an explicit sandbox environment and pair the API and widget origins. Keep keys on the server and derive the wallet from the authenticated user. Carry the complete browser-safe session through the port, harness and API. Bundle the small Circle onramp browser SDK locally, rather than depending on an external module CDN.

The modal shows loading, ready, submitted, cancellation/error, expiry and retry states. Deduplicate REST/SSE delivery, close old widgets, and ignore late async work after dismissal. Sandbox submission is not a confirmed deposit. Refresh actual balances on submission and close; do not create a payment receipt from browser events. Keep sandbox network selection available and explain that only Arc balances appear in Arcie.

Non-goals: voice-driven checkout, real purchases, production rollout, bank/card handling in Arcie, or a new onchain deposit indexer.
