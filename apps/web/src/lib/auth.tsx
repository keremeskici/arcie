import { usePrivy } from "@privy-io/react-auth";
import * as React from "react";

/** Shared interface for Privy, hosted demo, and local development sessions. */
export type Auth = {
  mode: "privy" | "demo" | "dev";
  ready: boolean;
  authenticated: boolean;
  getToken: () => Promise<string | null>;
  logout: () => Promise<void>;
  /** Dev mode only: enter as the demo user. */
  enterDemo?: () => void;
};

const Ctx = React.createContext<Auth | null>(null);

export function useAuth() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside an auth provider");
  return v;
}

/** Must render inside <PrivyProvider>. */
export function PrivyAuth({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const value = React.useMemo<Auth>(
    () => ({ mode: "privy", ready, authenticated, getToken: getAccessToken, logout }),
    [ready, authenticated, getAccessToken, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type DemoWalletSession = { token: string; expiresAt: string };

const DEMO_WALLET_SESSION_KEY = "arcie.demo-wallet-session";

export function readDemoWalletSession(): DemoWalletSession | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(DEMO_WALLET_SESSION_KEY) ?? "null") as DemoWalletSession | null;
    return typeof session?.token === "string" && Date.parse(session.expiresAt) > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function saveDemoWalletSession(session: DemoWalletSession | null) {
  try {
    if (session) sessionStorage.setItem(DEMO_WALLET_SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(DEMO_WALLET_SESSION_KEY);
  } catch {
    // The in-memory session still works when browser storage is unavailable.
  }
}

export function DemoWalletAuth({ session, onExit, children }: {
  session: DemoWalletSession;
  onExit: () => void;
  children: React.ReactNode;
}) {
  const { token, expiresAt } = session;
  React.useEffect(() => {
    const timeout = window.setTimeout(onExit, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [expiresAt, onExit]);

  const value = React.useMemo<Auth>(() => ({
    mode: "demo",
    ready: true,
    authenticated: true,
    getToken: async () => token,
    logout: async () => onExit(),
  }), [token, onExit]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const DEMO_KEY = "arcie.demo";

function readDemo() {
  try {
    return localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

export function DemoAuth({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = React.useState(readDemo);
  const value = React.useMemo<Auth>(
    () => ({
      mode: "dev",
      ready: true,
      authenticated,
      getToken: async () => null,
      logout: async () => {
        try {
          localStorage.removeItem(DEMO_KEY);
        } catch {
          /* private mode */
        }
        setAuthenticated(false);
      },
      enterDemo: () => {
        try {
          localStorage.setItem(DEMO_KEY, "1");
        } catch {
          /* private mode */
        }
        setAuthenticated(true);
      },
    }),
    [authenticated],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
