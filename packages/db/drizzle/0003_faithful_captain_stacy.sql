CREATE TABLE "arcie"."wallet_provisioning" (
	"user_id" text NOT NULL,
	"chain" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_provisioning_user_id_chain_pk" PRIMARY KEY("user_id","chain"),
	CONSTRAINT "wallet_provisioning_status" CHECK ("arcie"."wallet_provisioning"."status" in ('pending','created','uncertain'))
);
--> statement-breakpoint
ALTER TABLE "arcie"."users" ADD COLUMN "welcome_drip_tx" text;