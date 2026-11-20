import { useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { IconArrowLeft, IconBrandAppleFilled, IconMail, IconWallet } from "@tabler/icons-react";
import * as React from "react";
import { SiriOrb } from "@/components/ui/siri-orb";
import { Button } from "@/components/Button";
import { useAuth } from "@/lib/auth";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="phone px-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-7 pt-10">
        <SiriOrb size="168px" animationDuration={14} colors={{ bg: "#0a0a0f" }} />
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Arcie</h1>
          <p className="mt-2 text-[15px] text-muted">Your money. Just ask.</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 pb-8">{children}</div>
      <p className="pb-6 text-center text-xs text-muted">Testnet only · Powered by Arc and Circle</p>
    </div>
  );
}

/** Social first, email as fallback, wallet behind "More options" (spec §17). */
export function PrivyLogin({ onDemoLogin }: { onDemoLogin?: (() => Promise<void>) | undefined }) {
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const { login } = usePrivy();
  const [emailMode, setEmailMode] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [openingDemo, setOpeningDemo] = React.useState(false);
  const codeSent = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const busy = state.status === "sending-code" || state.status === "submitting-code";

  const run = (fn: () => Promise<void>) => {
    setError(null);
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : "Sign-in failed. Try again."));
  };

  if (emailMode) {
    return (
      <LoginShell>
        <button className="mb-1 inline-flex items-center gap-1.5 self-start text-sm text-muted" onClick={() => setEmailMode(false)}>
          <IconArrowLeft className="size-4" /> Back
        </button>
        {!codeSent ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), run(() => sendCode({ email })))}>
            <input
              className="h-14 rounded-2xl border border-line bg-card px-4 text-base outline-none focus:border-accent"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <Button type="submit" size="lg" disabled={!email || busy}>
              {busy ? "Sending…" : "Send me a code"}
            </Button>
          </form>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), run(() => loginWithCode({ code })))}>
            <p className="text-sm text-muted">Enter the 6-digit code we sent to {email}.</p>
            <input
              className="h-14 rounded-2xl border border-line bg-card px-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-accent"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            <Button type="submit" size="lg" disabled={code.length < 6 || busy}>
              {busy ? "Checking…" : "Continue"}
            </Button>
          </form>
        )}
        {error ? <p className="text-center text-sm text-danger">{error}</p> : null}
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      <Button size="lg" variant="light" disabled={oauthLoading} onClick={() => run(() => initOAuth({ provider: "google" }))}>
        <GoogleIcon /> Continue with Google
      </Button>
      <Button size="lg" variant="dark" disabled={oauthLoading} onClick={() => run(() => initOAuth({ provider: "apple" }))}>
        <IconBrandAppleFilled className="size-5" /> Continue with Apple
      </Button>
      <Button size="lg" variant="ghost" onClick={() => setEmailMode(true)}>
        <IconMail className="size-5" /> Continue with email
      </Button>
      {onDemoLogin ? (
        <Button size="lg" variant="outline" disabled={openingDemo} onClick={() => {
          setOpeningDemo(true);
          run(() => onDemoLogin().finally(() => setOpeningDemo(false)));
        }}>
          <IconWallet className="size-5" aria-hidden />
          {openingDemo ? "Opening demo wallet…" : "Open demo wallet"}
        </Button>
      ) : null}
      <button className="mt-1 text-sm text-muted underline-offset-4 hover:underline" onClick={() => login()}>
        More options
      </button>
      {error ? <p role="alert" className="text-center text-sm text-danger">{error}</p> : null}
    </LoginShell>
  );
}

/** Server runs AUTH_MODE=dev: there's no Privy app, so sign in as the server's demo user. */
export function DemoLogin() {
  const { enterDemo } = useAuth();
  return (
    <LoginShell>
      <Button size="lg" variant="light" onClick={enterDemo}>
        Enter demo wallet
      </Button>
      <p className="text-center text-xs text-muted">
        Demo mode: the server has no Privy app configured, so you'll use the shared demo account.
      </p>
    </LoginShell>
  );
}
