import type { ActionKind, AgentLimits, ChainId, Channel, IslandPayload } from "@arcie/core";
import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const now = () => new Date().toISOString();

/** Private application schema: browser roles get no access (see the migration hardening task). */
export const arcie = pgSchema("arcie");
const table = arcie.table;

export const users = table("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  homeChain: text("home_chain").$type<ChainId>().notNull(),
  email: text("email"),
  /** Wallet the user logged in with via Privy (identity only; the agent never uses it). */
  linkedWallet: text("linked_wallet").$type<`0x${string}`>(),
  /** Set when the testnet welcome drip was claimed (compare-and-set guards double drips). */
  welcomeDripAt: text("welcome_drip_at"),
  /** Transaction hash of the welcome drip, stored on success. */
  welcomeDripTx: text("welcome_drip_tx"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const wallets = table(
  "wallets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    chain: text("chain").$type<ChainId>().notNull(),
    circleWalletId: text("circle_wallet_id").notNull(),
    address: text("address").$type<`0x${string}`>().notNull(),
    accountType: text("account_type").$type<"EOA" | "SCA">().notNull(),
  },
  (t) => [uniqueIndex("wallets_user_chain").on(t.userId, t.chain)],
);

/** One Circle creation attempt per (user, chain): every instance reuses the stored idempotency key. */
export const walletProvisioning = table(
  "wallet_provisioning",
  {
    userId: text("user_id").notNull(),
    chain: text("chain").$type<ChainId>().notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    status: text("status").$type<"pending" | "created" | "uncertain">().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.chain] }),
    check("wallet_provisioning_status", sql`${t.status} in ('pending','created','uncertain')`),
  ],
);

export const contacts = table(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    address: text("address").$type<`0x${string}`>().notNull(),
    chain: text("chain").$type<ChainId>().notNull(),
  },
  (t) => [uniqueIndex("contacts_user_name").on(t.userId, t.name)],
);

export const limits = table("limits", {
  userId: text("user_id").primaryKey().references(() => users.id),
  json: jsonb("json").$type<AgentLimits>().notNull(),
});

export const sessions = table("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  channel: text("channel").$type<Channel>().notNull(),
  /** Count of user messages seen; voice confirm needs userTurn > intent.previewTurn. */
  userTurn: integer("user_turn").notNull().default(0),
  /** Voice sessions minted for a logged-in user expire; null = dev/legacy session. */
  expiresAt: text("expires_at"),
});

export type IntentStatus =
  | "validating"
  | "rejected"
  | "awaiting_confirmation"
  | "expired"
  | "cancelled"
  | "executing"
  | "succeeded"
  | "failed";

/**
 * Cross-instance coordination per session. Rows are created on demand (screen sessions have no `sessions` row).
 * `proposal_generation` orders proposals and cancels; `preparing_generation` is set while a proposal is in flight.
 */
export const sessionState = table("session_state", {
  sessionId: text("session_id").primaryKey(),
  proposalGeneration: integer("proposal_generation").notNull().default(0),
  preparingGeneration: integer("preparing_generation"),
  nextEventSeq: bigint("next_event_seq", { mode: "number" }).notNull().default(1),
});

/**
 * Durable per-session island log behind `/events`. `seq` comes from `session_state.next_event_seq`, allocated
 * in the writer's transaction (which holds that row lock until commit), so seqs commit in order per session.
 */
export const sessionEvents = table(
  "session_events",
  {
    sessionId: text("session_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    payload: jsonb("payload").$type<IslandPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.seq] })],
);

export const intents = table(
  "intents",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    kind: text("kind").$type<ActionKind>().notNull(),
    chain: text("chain").$type<ChainId>().notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    paramsHash: text("params_hash").notNull(),
    preview: jsonb("preview").$type<Record<string, unknown>>(),
    status: text("status").$type<IntentStatus>().notNull(),
    statusReason: text("status_reason"),
    usdValue: text("usd_value"),
    previewTurn: integer("preview_turn").notNull().default(0),
    quoteAt: text("quote_at"),
    confirmedVia: text("confirmed_via").$type<Channel>(),
    supersededBy: text("superseded_by"),
    txHash: text("tx_hash"),
    actuals: jsonb("actuals").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<{ code: string; message: string }>(),
    createdAt: text("created_at").notNull().$defaultFn(now),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
    expiresAt: text("expires_at"),
    /** Bumped by every change to params, params_hash, preview or expires_at; a confirmation claim is only valid for the revision it saw. */
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    // A session never has two Confirm cards open: the database refuses the second.
    uniqueIndex("intents_one_pending_per_session").on(t.sessionId).where(sql`${t.status} = 'awaiting_confirmation'`),
  ],
);

/**
 * Expiring execution claim on an intent, so two server instances never act on one confirmation.
 * `token` fences writes; `expires_at` is compared against database time only.
 */
export const confirmClaims = table("confirm_claims", {
  intentId: text("intent_id").primaryKey().references(() => intents.id),
  token: uuid("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const choices = table("choices", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  question: text("question").notNull(),
  options: jsonb("options")
    .$type<{ id: string; label: string; detail?: string }[]>()
    .notNull(),
  selectedOptionId: text("selected_option_id"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const audit = table("audit", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  intentId: text("intent_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  createdAt: text("created_at").notNull().$defaultFn(now),
});
