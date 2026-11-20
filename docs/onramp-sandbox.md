# Test the sandbox checkout

Use `ONRAMP_ENVIRONMENT=sandbox` (the default) and a testnet `ONRAMP_API_KEY` from [Circle Console → App Kits → Onramp Kit](https://console.circle.com/app-kits/onramp). `ONRAMP_REFERRER_DOMAIN=localhost` is suitable for local testing. Restart after changing `.env`. Never put the API key in browser configuration.

1. Run `pnpm dev` and `pnpm web` in separate terminals. Open the wallet at http://localhost:5173 and sign in.
2. Tap **Add money**, choose the currency and tap **Open checkout**. A dialog shows **Sandbox · No real money** and Circle's checkout. Enter the desired amount in checkout; the optional Arcie amount is a fiat prefill, not a guaranteed token output.
3. Alternatively, tell the connected voice assistant **“I want to deposit money.”** Its only job is to open the same dialog. Identity checks and payment steps are completed on screen. The text chat can exercise the same agent-to-screen path without a microphone.
4. Use only dummy identity/payment details. Follow the sandbox widget's instructions. Phone OTP `123456` passes; `000000` tests rejection. Do not enter real card information or upload real ID.
5. Submission should show **Sandbox submission complete**. It is not proof of a deposit. Sandbox doesn't emit a settled callback, so the UI does not wait for one.
6. Test closing with **Close** or Escape, reopening, and **Restart checkout** after an expired or failed session. A button response and its accompanying voice/event stream should never create two iframes.

Circle documents that bank-transfer test deposits land only on Ethereum. Sandbox checkout leaves its supported test networks available; Arcie's balance screen still reads Arc Testnet. A test deposit on another network will not appear in that balance. Check the destination address on the actual network selected in Circle. The app refreshes real balances after submission and closing; it never invents a balance increase or confirms funds from a browser callback.

If checkout cannot load, confirm that the key is a testnet key, the server has restarted, and the browser can reach `onramp-sandbox.arc.io`. If hosting behind a Content Security Policy, allow that origin in `frame-src`. The React wallet bundles the Circle browser SDK. The older server console serves the same checkout controller at `/assets/onramp.js`.

[Circle sandbox behavior](https://docs.arc.io/app-kit/references/onramp-hosting-requirements#testing-behavior)
