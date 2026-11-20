import { api } from "./api";

/** Each independent ElevenLabs history gets its own server-issued capability and turn counter. */
export function requestVoiceSession(ready: (id: string) => void, failed: (message: string) => void) {
  const controller = new AbortController();
  void api.post<{ sessionId: string }>("/voice/session", {}, null, controller.signal).then(({ sessionId }) => {
    if (!controller.signal.aborted) ready(sessionId);
  }).catch(() => {
    if (!controller.signal.aborted) failed("Couldn't start a voice session. Close voice and try again.");
  });
  return () => controller.abort();
}
