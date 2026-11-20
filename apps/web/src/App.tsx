import { PrivyProvider } from "@privy-io/react-auth";
import * as React from "react";
import { api, type ServerConfig } from "@/lib/api";
import { DemoAuth, PrivyAuth, useAuth } from "@/lib/auth";
import { DemoLogin, PrivyLogin } from "@/screens/Login";
import { SignedIn } from "@/screens/SignedIn";
import { Splash } from "@/components/Splash";

export function App() {
  const [config, setConfig] = React.useState<ServerConfig | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.get<ServerConfig>("/config").then(setConfig, () => setError("Can't reach the Arcie server."));
  }, []);

  if (error) return <Splash message={error} />;
  if (!config) return <Splash />;

  if (config.authMode === "privy" && config.privyAppId) {
    return (
      <PrivyProvider
        appId={config.privyAppId}
        config={{
          loginMethods: ["google", "apple", "email", "wallet"],
          appearance: { theme: "dark", accentColor: "#8b7cff", showWalletLoginFirst: false },
          embeddedWallets: { ethereum: { createOnLogin: "off" } },
        }}
      >
        <PrivyAuth>
          <Gate config={config} login={<PrivyLogin />} />
        </PrivyAuth>
      </PrivyProvider>
    );
  }
  return (
    <DemoAuth>
      <Gate config={config} login={<DemoLogin />} />
    </DemoAuth>
  );
}

function Gate({ config, login }: { config: ServerConfig; login: React.ReactNode }) {
  const auth = useAuth();
  if (!auth.ready) return <Splash />;
  return auth.authenticated ? <SignedIn config={config} /> : <>{login}</>;
}
