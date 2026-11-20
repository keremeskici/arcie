import { ConversationProvider } from "@elevenlabs/react";
import * as React from "react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/Button";
import { ReceiveSheet } from "@/components/ReceiveSheet";
import { SendSheet } from "@/components/SendSheet";
import { Splash } from "@/components/Splash";
import { api, setSessionId, setTokenGetter, type AuthSession, type ServerConfig } from "@/lib/api";
import { requestVoiceSession } from "@/lib/voice-session";
import { useAuth } from "@/lib/auth";
import { IslandsProvider } from "@/lib/islands";
import { VoiceScreen } from "@/screens/Voice";
import { WalletScreen } from "@/screens/Wallet";

type Voice = { sessionId: string | null; error?: string };
type Boot = { account: AuthSession; sessionId: string; voice: Voice | null };

/** After login: onboard (creates the Circle wallet on first login), then mint the voice/island session. */
export function SignedIn({ config }: { config: ServerConfig }) {
  const auth = useAuth();
  const [boot, setBoot] = React.useState<Boot | null>(null);
  const pendingVoice = React.useRef<(() => void) | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  const getToken = React.useRef(auth.getToken);
  getToken.current = auth.getToken;

  React.useEffect(() => {
    let live = true;
    setTokenGetter(() => getToken.current());
    (async () => {
      const account = await api.post<AuthSession>("/auth/session");
      if (!live) return;
      const voice = await api.post<{ sessionId: string; expiresAt: string }>("/voice/session");
      if (!live) return;
      setSessionId(voice.sessionId);
      setBoot({ account, sessionId: voice.sessionId, voice: null });
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Couldn't open your wallet."));
    return () => {
      live = false;
      pendingVoice.current?.();
      setSessionId(null);
      setTokenGetter(async () => null);
    };
  }, []);

  function closeVoice() {
    pendingVoice.current?.();
    setBoot((old) => old && { ...old, voice: null });
  }
  function openVoice() {
    pendingVoice.current?.();
    setBoot((old) => old && { ...old, voice: { sessionId: null } });
    if (!config.elevenLabsAgentId) return;
    pendingVoice.current = requestVoiceSession((sessionId) => {
      setSessionId(sessionId);
      setBoot((old) => old && { ...old, sessionId, voice: { sessionId } });
    }, (error) => setBoot((old) => old && { ...old, voice: { sessionId: null, error } }));
  }

  if (error) {
    return (
      <Splash message={error}>
        {auth.mode === "demo" ? <Button variant="outline" onClick={() => void auth.logout()}>Back to sign-in</Button> : null}
      </Splash>
    );
  }
  if (!boot) return <Splash message="Opening your wallet…" />;

  return (
    <IslandsProvider sessionId={boot.sessionId}>
      <ConversationProvider key={boot.sessionId}>
        <Home config={config} account={boot.account} voice={boot.voice} openVoice={openVoice} closeVoice={closeVoice} />
      </ConversationProvider>
    </IslandsProvider>
  );
}

function Home({ config, account, voice, openVoice, closeVoice }: {
  config: ServerConfig; account: AuthSession; voice: Voice | null; openVoice: () => void; closeVoice: () => void;
}) {
  const [sendOpen, setSendOpen] = React.useState(false);
  const [receiveOpen, setReceiveOpen] = React.useState(false);

  return (
    <>
      <WalletScreen
        account={account}
        onSend={() => setSendOpen(true)}
        onReceive={() => setReceiveOpen(true)}
        onVoice={openVoice}
      />
      {voice ? <VoiceScreen agentId={config.elevenLabsAgentId} sessionId={voice.sessionId} sessionError={voice.error} onClose={closeVoice} /> : null}
      <SendSheet open={sendOpen} onOpenChange={setSendOpen} />
      <ReceiveSheet open={receiveOpen} onOpenChange={setReceiveOpen} />
      <ActionSheet />
    </>
  );
}
