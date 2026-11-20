# Login with Privy

The design is in spec §17. Privy **identifies** the person. Their money stays in the Circle developer-controlled wallet that Arcie creates on first login. Privy's own embedded wallets stay off.

## 1. Dashboard setup (dashboard.privy.io → your app)

1. **Login methods:** enable **Google**, **Apple** and **Email**. Also enable **Wallet** (external wallets such as MetaMask or Rabby).
2. **Embedded wallets:** turn **off** automatic creation on login. Users only ever see one wallet, the Arcie one.
3. **Allowed origins:** add `http://localhost:5173` (Vite dev) and the deployed app origin.
4. **App settings → Verification key:** copy it into `.env` as `PRIVY_JWT_VERIFICATION_KEY`. It's optional, but it saves a network round-trip on every request.
5. Optional, for demos: **Test accounts**, which give you a fixed email and OTP to sign in without a real inbox.

## 2. Server env

```
PRIVY_APP_ID=…            # App settings
PRIVY_APP_SECRET=…        # App settings → API keys
PRIVY_JWT_VERIFICATION_KEY=   # optional
AUTH_MODE=privy           # "dev" keeps the x-arcie-user header / demo user for tests and the REPL
WELCOME_DRIP_USDC=2       # optional testnet welcome credit from ADMIN_PRIVATE_KEY (once per user)
```

`AUTH_MODE=privy` also needs `CIRCLE_WALLET_SET_ID`, which `pnpm provision` writes for you.

## 3. Client config (UI phase)

The goal is social first, wallet behind "More options", and no embedded wallet. A sketch for `@privy-io/react-auth`:

```tsx
<PrivyProvider
  appId={import.meta.env.VITE_PRIVY_APP_ID}
  config={{
    loginMethods: ["google", "apple", "email", "wallet"],
    appearance: { showWalletLoginFirst: false, theme: "light" },
    embeddedWallets: { ethereum: { createOnLogin: "off" } },
  }}
>
```

> Check these key names against the installed `@privy-io/react-auth` version when building the UI. The login-method ordering/overflow option (`loginMethodsAndOrder`) is what moves "wallet" to the secondary screen. If the app goes native, Privy's Expo SDK uses the same backend contract below.

## 4. The token flow

```
login (Privy modal)
  → token = await getAccessToken()                      // ~1h, auto-refreshes
  → POST /auth/session   Authorization: Bearer <token>  // idempotent: user, limits, Circle wallet, welcome drip
       ← { user, wallet: { address, chain }, limits, dripTx }
  → every REST call: Authorization: Bearer <token>       // a 401 UNAUTHENTICATED means: getAccessToken() again and retry
  → before voice: POST /voice/session                    ← { sessionId, expiresAt }  (2h, bound to this user)
       start ElevenLabs with custom-LLM extra body { session_id: sessionId }
       open EventSource(`/events?sessionId=${sessionId}`) for the islands
       send REST calls with header x-arcie-session: <sessionId> so taps land in the same session
```

The server never trusts `user_id` in the custom-LLM request body. Those requests come from ElevenLabs' servers, so the voice session id is what binds the conversation to the logged-in user.

## 5. Checking a real token

```bash
pnpm check-token <privy-access-token>
```

This prints the verified identity: your Privy user id, the display name taken from Google, Apple or email, and any linked external wallet. To get a token, sign in through the UI (or with a Privy test account) and run `await getAccessToken()` in the browser console.
