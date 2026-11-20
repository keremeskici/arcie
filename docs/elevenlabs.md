# ElevenLabs voice agent (custom LLM)

Agent: **Arcie** (`agent_1401m6s51b0ke7zr7se63496bhrz`). ElevenLabs handles speech-to-text and text-to-speech. All reasoning and money actions run on the Arcie backend, which ElevenLabs calls as an OpenAI-compatible **custom LLM**.

## 1. Expose the server

```bash
pnpm dev                                         # http://localhost:8787
cloudflared tunnel --url http://localhost:8787   # prints https://<random>.trycloudflare.com
```

(Use ngrok or a real deploy instead if you prefer. The endpoint is `<public-url>/v1/chat/completions`.)

## 2. Agent LLM settings

| Setting | Value |
|---|---|
| LLM | `custom-llm` |
| Custom LLM URL | `https://<public-url>/v1` (ElevenLabs appends `/chat/completions`) |
| Model id | value of `OPENAI_MODEL` (informational; the server picks the model) |
| API key | workspace secret `arcie_llm_api_key` = the raw `LLM_SHARED_SECRET` (**not** a request header; see §5) |
| Temperature | unset (null) |
| Custom LLM extra body | **on** (lets the app pass `session_id`) |
| Backup LLM | **disabled**, so ElevenLabs can never fall back to a model that could claim "sent!" without our harness |
| Cascade timeout | **15 s**, because the first word can follow a tool call or an onchain send |

The server ignores ElevenLabs' system prompt and uses its own (`apps/server/src/llm/prompt.ts`).

## 3. Identity

- **`AUTH_MODE=dev`** (local demos): requests without a session id go to the demo user's default session.
- **`AUTH_MODE=privy`** (real users): the app calls `POST /voice/session` and starts the conversation with custom-LLM extra body `{ session_id }`. The server takes the user **only** from that session (see `docs/privy.md`).

## 4. The UI phase

- Start the conversation with `customLlmExtraBody: { session_id }` and open `EventSource('/events?sessionId=…')` for the islands.
- After a **tap** on the confirm card (`POST /intents/:id/confirm` with header `x-arcie-session`), send the live conversation a contextual update, e.g. "User confirmed intent X on screen", so the voice can read the receipt. The exact SDK call (`sendContextualUpdate`) needs checking against the installed `@elevenlabs/react` version.

## 5. Observed request format

Set `LOG_LLM_REQUESTS=1` to log each request's top-level fields and the auth header *shape* (never the message text or the secret value).

Observed 2026-11-07, from ElevenLabs agent tests through a Cloudflare tunnel:
- ElevenLabs calls the endpoint **with the OpenAI SDK** (`x-stainless-*` headers). The SDK sets its own `Authorization: Bearer <api_key>`, which **overwrites** any `Authorization` you put in `request_headers`. So the shared secret goes in the custom LLM **`api_key`** field (as a workspace secret holding the raw value).
- Body: `{ model, stream: true, max_completion_tokens: 8192, stream_options: { include_usage: true }, messages: [system, assistant(first message), user, …] }`. Without client extra body there is no `user_id`/`session_id`, so dev mode uses the demo user's `default:demo` session.
- A 4 s cascade timeout made ElevenLabs abandon and retry turns that run a tool first (about 7 s per answer). At 15 s it's one attempt: about 3.5 s for a balance and about 4.7 s for a send proposal. The retry was harmless (a new request aborts the old turn, and confirm is at-most-once), but slow.

**Verified by voice (ElevenLabs LLM tests):**
- "What's my balance?" → "You have 4.792017 USDC and 2.956411 EURC." (live wallet)
- "Send 0.1 dollars to Savings." → "Send 0.1 USDC to Savings, fee under a cent. Say confirm, or tap the card."
- "Yes, confirm." → "Done. Sent 0.1 USDC to Savings." The intent shows `succeeded`, `confirmed_via: voice`, tx `0x129da737…1e63` on Arc Testnet. That turn took about 10 s, mostly the onchain send.
