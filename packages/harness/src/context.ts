import type { Channel } from "@arcie/core";

/** Who is acting, where, and on which user turn. Built per request by the server. */
export interface HarnessCtx {
  userId: string;
  sessionId: string;
  channel: Channel;
  /** Count of user messages so far in this session (voice confirm needs > intent.previewTurn). */
  userTurn: number;
  now: () => Date;
  /** One agent turn / API call; groups the Steps island. */
  runId: string;
  signal?: AbortSignal;
  /** Correlates a tapped checkout request with its REST and SSE delivery. */
  onrampRequestId?: string;
  /** A screen can opt to render receive details directly from its HTTP response. */
  receiveResponseOnly?: boolean;
}
