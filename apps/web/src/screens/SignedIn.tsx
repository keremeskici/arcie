import { ConversationProvider } from "@elevenlabs/react";
import * as React from "react";
import { ActionSheet } from "@/components/ActionSheet";
import { ReceiveSheet } from "@/components/ReceiveSheet";
import { SendSheet } from "@/components/SendSheet";
import { Splash } from "@/components/Splash";
import { api, setSessionId, setTokenGetter, type AuthSession, type ServerConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { IslandsProvider } from "@/lib/islands";
import { VoiceScreen } from "@/screens/Voice";
import { WalletScreen } from "@/screens/Wallet";

type Boot = { account: AuthSession; sessionId: string };

/** After login: onboard (creates the Circle wallet on first login), then mint the voice/island session. */
export function SignedIn({ config }: { config: ServerConfig }) {
  const auth = useAuth();
  const [boot, setBoot] = React.useState<Boot | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const getToken = React.useRef(auth.getToken);
  getToken.current = auth.getToken;

  React.useEffect(() => {
    let live = true;
    setTokenGetter(() => getToken.current());
    (async () => {
      const account = await api.post<AuthSession>("/auth/session");
      const voice = await api.post<{ sessionId: string; expiresAt: string }>("/voice/session");
      setSessionId(voice.sessionId);
      if (live) setBoot({ account, sessionId: voice.sessionId });
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Couldn't open your wallet."));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <Splash message={error} />;
  if (!boot) return <Splash message="Opening your wallet…" />;

  return (
    <IslandsProvider sessionId={boot.sessionId}>
      <ConversationProvider>
        <Home config={config} account={boot.account} sessionId={boot.sessionId} />
      </ConversationProvider>
    </IslandsProvider>
  );
}

function Home({ config, account, sessionId }: { config: ServerConfig; account: AuthSession; sessionId: string }) {
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [receiveOpen, setReceiveOpen] = React.useState(false);

  return (
    <>
      <WalletScreen
        account={account}
        onSend={() => setSendOpen(true)}
        onReceive={() => setReceiveOpen(true)}
        onVoice={() => setVoiceOpen(true)}
      />
      {voiceOpen ? <VoiceScreen agentId={config.elevenLabsAgentId} sessionId={sessionId} onClose={() => setVoiceOpen(false)} /> : null}
      <SendSheet open={sendOpen} onOpenChange={setSendOpen} />
      <ReceiveSheet open={receiveOpen} onOpenChange={setReceiveOpen} />
      <ActionSheet />
    </>
  );
}
