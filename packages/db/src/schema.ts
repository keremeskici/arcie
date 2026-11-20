import type { ActionKind, AgentLimits, ChainId, Channel, ChoiceIsland } from "@arcie/core";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => new Date().toISOString();

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  homeChain: text("home_chain").$type<ChainId>().notNull(),
  email: text("email"),
  /** Wallet the user logged in with via Privy (identity only; the agent never uses it). */
  linkedWallet: text("linked_wallet").$type<`0x${string}`>(),
  /** Set when the testnet welcome drip was claimed (compare-and-set guards double drips). */
  welcomeDripAt: text("welcome_drip_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const wallets = sqliteTable(
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

export const contacts = sqliteTable(
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

export const limits = sqliteTable("limits", {
  userId: text("user_id").primaryKey().references(() => users.id),
  json: text("json", { mode: "json" }).$type<AgentLimits>().notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  channel: text("channel").$type<Channel>().notNull(),
  /** Count of user messages seen; voice confirm needs userTurn > intent.previewTurn. */
  userTurn: integer("user_turn").notNull().default(0),
  conversationId: text("conversation_id"),
  conversationStartTurn: integer("conversation_start_turn").notNull().default(0),
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

export const intents = sqliteTable("intents", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<ActionKind>().notNull(),
  chain: text("chain").$type<ChainId>().notNull(),
  params: text("params", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  paramsHash: text("params_hash").notNull(),
  preview: text("preview", { mode: "json" }).$type<Record<string, unknown>>(),
  status: text("status").$type<IntentStatus>().notNull(),
  statusReason: text("status_reason"),
  usdValue: text("usd_value"),
  previewTurn: integer("preview_turn").notNull().default(0),
  quoteAt: text("quote_at"),
  confirmedVia: text("confirmed_via").$type<Channel>(),
  supersededBy: text("superseded_by"),
  txHash: text("tx_hash"),
  actuals: text("actuals", { mode: "json" }).$type<Record<string, unknown>>(),
  error: text("error", { mode: "json" }).$type<{ code: string; message: string }>(),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
  expiresAt: text("expires_at"),
});

export const choices = sqliteTable("choices", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  question: text("question").notNull(),
  options: text("options", { mode: "json" })
    .$type<{ id: string; label: string; detail?: string }[]>()
    .notNull(),
  selectedOptionId: text("selected_option_id"),
  userId: text("user_id"),
  send: text("send_params", { mode: "json" }).$type<NonNullable<ChoiceIsland["send"]>>(),
  previewTurn: integer("preview_turn"),
  expiresAt: text("expires_at"),
  closedAt: text("closed_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const audit = sqliteTable("audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  intentId: text("intent_id"),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
  createdAt: text("created_at").notNull().$defaultFn(now),
});
