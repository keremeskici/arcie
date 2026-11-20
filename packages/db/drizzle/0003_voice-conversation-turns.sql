ALTER TABLE `sessions` ADD `conversation_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `conversation_start_turn` integer DEFAULT 0 NOT NULL;