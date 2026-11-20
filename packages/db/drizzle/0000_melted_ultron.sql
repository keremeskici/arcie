CREATE SCHEMA "arcie";
--> statement-breakpoint
CREATE TABLE "arcie"."audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "arcie"."audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"session_id" text,
	"intent_id" text,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcie"."choices" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"selected_option_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcie"."contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"chain" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcie"."intents" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"chain" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" text NOT NULL,
	"preview" jsonb,
	"status" text NOT NULL,
	"status_reason" text,
	"usd_value" text,
	"preview_turn" integer DEFAULT 0 NOT NULL,
	"quote_at" text,
	"confirmed_via" text,
	"superseded_by" text,
	"tx_hash" text,
	"actuals" jsonb,
	"error" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"expires_at" text
);
--> statement-breakpoint
CREATE TABLE "arcie"."limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcie"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"user_turn" integer DEFAULT 0 NOT NULL,
	"expires_at" text
);
--> statement-breakpoint
CREATE TABLE "arcie"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"home_chain" text NOT NULL,
	"email" text,
	"linked_wallet" text,
	"welcome_drip_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcie"."wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chain" text NOT NULL,
	"circle_wallet_id" text NOT NULL,
	"address" text NOT NULL,
	"account_type" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arcie"."contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "arcie"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcie"."intents" ADD CONSTRAINT "intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "arcie"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcie"."limits" ADD CONSTRAINT "limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "arcie"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcie"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "arcie"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcie"."wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "arcie"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_name" ON "arcie"."contacts" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_chain" ON "arcie"."wallets" USING btree ("user_id","chain");