CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`intent_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `choices` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`selected_option_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`chain` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_name` ON `contacts` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `intents` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`chain` text NOT NULL,
	`params` text NOT NULL,
	`params_hash` text NOT NULL,
	`preview` text,
	`status` text NOT NULL,
	`status_reason` text,
	`usd_value` text,
	`preview_turn` integer DEFAULT 0 NOT NULL,
	`quote_at` text,
	`confirmed_via` text,
	`superseded_by` text,
	`tx_hash` text,
	`actuals` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `limits` (
	`user_id` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`user_turn` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`home_chain` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chain` text NOT NULL,
	`circle_wallet_id` text NOT NULL,
	`address` text NOT NULL,
	`account_type` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_user_chain` ON `wallets` (`user_id`,`chain`);