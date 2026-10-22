CREATE TABLE `auth_login_attempts` (
	`attempt_key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer,
	`consumption_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_recovery_user_hash_uq` ON `auth_recovery_codes` (`user_id`,`code_hash`);--> statement-breakpoint
CREATE INDEX `auth_recovery_user_used_idx` ON `auth_recovery_codes` (`user_id`,`used_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret_encrypted` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_pending_secret_encrypted` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_pending_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled` integer DEFAULT false NOT NULL;