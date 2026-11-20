CREATE TABLE "arcie"."confirm_claims" (
	"intent_id" text PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arcie"."intents" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arcie"."confirm_claims" ADD CONSTRAINT "confirm_claims_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "arcie"."intents"("id") ON DELETE no action ON UPDATE no action;