import { usePrivy } from "@privy-io/react-auth";
import * as React from "react";

/** One login surface for both server modes: Privy (real users) and dev (the server's demo user). */
export type Auth = {
  mode: "privy" | "dev";
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
