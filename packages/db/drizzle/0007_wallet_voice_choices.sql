ALTER TABLE "arcie"."choices" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "arcie"."choices" ADD COLUMN "send_params" jsonb;--> statement-breakpoint
ALTER TABLE "arcie"."choices" ADD COLUMN "preview_turn" integer;--> statement-breakpoint
ALTER TABLE "arcie"."choices" ADD COLUMN "expires_at" text;--> statement-breakpoint
ALTER TABLE "arcie"."choices" ADD COLUMN "closed_at" text;--> statement-breakpoint
ALTER TABLE "arcie"."sessions" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "arcie"."sessions" ADD COLUMN "conversation_start_turn" integer DEFAULT 0 NOT NULL;