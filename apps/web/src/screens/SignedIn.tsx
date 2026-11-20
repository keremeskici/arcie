import { ConversationProvider } from "@elevenlabs/react";
import * as React from "react";
import { ActionSheet } from "@/components/ActionSheet";
import { ReceiveSheet } from "@/components/ReceiveSheet";
import { SendSheet } from "@/components/SendSheet";
import { Splash } from "@/components/Splash";
import { api, setSessionId, setTokenGetter, type AuthSession, type ServerConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { IslandsProvider, useIslands } from "@/lib/islands";
import { VoiceAccessContext, type VoiceHandoff } from "@/lib/voice-access";
import { VoiceScreen } from "@/screens/Voice";
import { AccountSheet, ActivitySheet, ContactsSheet } from "@/components/AccountSheets";
import { OnrampSheet } from "@/components/OnrampSheet";
import { SwapSheet } from "@/components/SwapSheet";
import { ChatScreen } from "@/screens/Chat";
import { WalletScreen, type WalletTool } from "@/screens/Wallet";

type Boot = { account: AuthSession; sessionId: string };

/** After login: onboard (creates the Circle wallet on first login), then mint the voice/island session. */
export function SignedIn({ config }: { config: ServerConfig }) {
  const auth = useAuth();
  const [boot, setBoot] = React.useState<Boot | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [attempt, setAttempt] = React.useState(0);
  const getToken = React.useRef(auth.getToken);
  getToken.current = auth.getToken;

  React.useEffect(() => {
    let active = true;
    let renewing = false;
    let expiresAt = Infinity;
    let timer: ReturnType<typeof setTimeout>;
    let account: AuthSession;
    setTokenGetter(() => getToken.current());

    function failed(e: unknown) {
      if (active) setError(e instanceof Error ? e.message : "Couldn't open your wallet.");
    }

    async function renew() {
      if (!active || renewing || !account) return;
      renewing = true;
      try {
        const voice = await api.post<{ sessionId: string; expiresAt: string }>("/voice/session");
        if (!active) return;
        expiresAt = Date.parse(voice.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Your wallet session expired. Please reconnect.");
        setSessionId(voice.sessionId);
        setBoot({ account, sessionId: voice.sessionId });
        setError(null);
        clearTimeout(timer);
        timer = setTimeout(renew, Math.max(1, expiresAt - Date.now()));
      } catch (e) {
        failed(e);
      } finally {
        renewing = false;
      }
    }
    function onWake() {
      if (!document.hidden && Date.now() >= expiresAt) void renew();
    }

    api.post<AuthSession>("/auth/session").then(result => {
      account = result;
      return renew();
    }).catch(failed);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      setSessionId(null);
      setTokenGetter(async () => null);
    };
  }, [attempt]);

  if (error) return <Splash message={error} onRetry={() => { setBoot(null); setError(null); setAttempt(n => n + 1); }} />;
  if (!boot) return <Splash message="Opening your wallet…" />;

  return (
    <IslandsProvider key={boot.sessionId} sessionId={boot.sessionId}>
      <ConversationProvider>
        <Home config={config} account={boot.account} sessionId={boot.sessionId} />
      </ConversationProvider>
    </IslandsProvider>
  );
}

function Home({ config, account, sessionId }: { config: ServerConfig; account: AuthSession; sessionId: string }) {
  const [tool, setTool] = React.useState<WalletTool | null>(null);
  const [draft, setDraft] = React.useState("");
  const close = () => setTool(null);
  const [voice, setVoice] = React.useState<"closed" | "visible" | VoiceHandoff>("closed");
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const { receive, confirm, choice, openScreen, clear } = useIslands();
  const handoff = voice === "closed" || voice === "visible" ? null : voice;

  const openVoice = React.useCallback((from?: HTMLElement) => {
    returnFocus.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setVoice("visible");
  }, []);
  React.useLayoutEffect(() => {
    if (voice !== "closed" || !returnFocus.current) return;
    const origin = returnFocus.current;
    const frame = requestAnimationFrame(() => {
      if (origin.isConnected && !origin.closest("[inert], [data-base-ui-inert], [hidden]")) origin.focus({ preventScroll: true });
      returnFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [voice]);
  function beginHandoff(next: VoiceHandoff) {
    if (voice === "closed") return;
    if (next !== "receive") clear("receive");
    setVoice(next);
  }
  function finishHandoff(previous: VoiceHandoff) {
    setVoice(current => current === previous ? "visible" : current);
  }
  function closeTool(name: "onramp" | "contacts" | "activity") {
    setTool(current => current === name ? null : current);
    finishHandoff(name);
  }
  function checkoutOpenChanged(open: boolean) {
    if (open) setTool("onramp");
    else closeTool("onramp");
  }

  const presentReadScreen = React.useEffectEvent((screen: "receive" | "activity" | "contacts") => beginHandoff(screen));
  React.useLayoutEffect(() => {
    if (receive) presentReadScreen("receive");
  }, [receive]);
  const lastScreenRequest = React.useRef<string | undefined>(undefined);
  React.useLayoutEffect(() => {
    if (!openScreen) return;
    if (lastScreenRequest.current !== openScreen.requestId) {
      lastScreenRequest.current = openScreen.requestId;
      presentReadScreen(openScreen.screen);
    }
    clear("openScreen", openScreen.requestId);
  }, [openScreen, clear]);

  // A fresh review or contact choice needs the live voice controls even after a handoff.
  const reviewKey = choice?.choiceId ?? (confirm ? `${confirm.intentId}/${confirm.expiresAt}` : null);
  React.useLayoutEffect(() => {
    if (reviewKey) setVoice(current => current === "closed" ? current : "visible");
  }, [reviewKey]);

  const voiceAccess = React.useMemo(() => ({
    openVoice, visible: voice === "visible", inBackground: handoff !== null,
    activeSheet: handoff ?? (tool === "onramp" ? "onramp" : null), returnFocus,
  }), [voice, handoff, tool, openVoice]);

  return (
    <VoiceAccessContext.Provider value={voiceAccess}>
      <div inert={tool === "chat"} aria-hidden={tool === "chat" || undefined}>
        <WalletScreen
          account={account}
          onSend={() => setSendOpen(true)}
          onReceive={() => setReceiveOpen(true)}
          onVoice={event => openVoice(event.currentTarget)}
          onTool={setTool}
        />
      </div>
      {voice !== "closed" && (
        <VoiceScreen
          agentId={config.elevenLabsAgentId}
          sessionId={sessionId}
          visible={voice === "visible"}
          onClose={() => setVoice("closed")}
        />
      )}
      <SendSheet open={sendOpen} onOpenChange={setSendOpen} />
      <ReceiveSheet open={receiveOpen} onOpenChange={open => { setReceiveOpen(open); if (!open) finishHandoff("receive"); }} />
      <ChatScreen open={tool === "chat"} onClose={close} draft={draft} setDraft={setDraft} />
      {tool === "account" && <AccountSheet onClose={close} />}
      {(tool === "activity" || handoff === "activity") && <ActivitySheet onClose={() => closeTool("activity")} />}
      {(tool === "contacts" || handoff === "contacts") && <ContactsSheet onClose={() => closeTool("contacts")} />}
      {tool === "swap" && <SwapSheet onClose={close} />}
      <OnrampSheet open={tool === "onramp"} onOpenChange={checkoutOpenChanged} onVoiceOpen={() => beginHandoff("onramp")} />
      <ActionSheet onFollowUp={message => { setDraft(message); setTool("chat"); }} />
    </VoiceAccessContext.Provider>
  );
}
