CREATE TABLE "arcie"."session_state" (
	"session_id" text PRIMARY KEY NOT NULL,
	"proposal_generation" integer DEFAULT 0 NOT NULL,
	"preparing_generation" integer,
	"next_event_seq" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "intents_one_pending_per_session" ON "arcie"."intents" USING btree ("session_id") WHERE "arcie"."intents"."status" = 'awaiting_confirmation';