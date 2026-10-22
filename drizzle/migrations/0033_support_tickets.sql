CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`phone` text NOT NULL,
	`activity_type` text NOT NULL,
	`preferred_at` integer,
	`details` text NOT NULL,
	`language` text DEFAULT 'ar' NOT NULL,
	`source` text DEFAULT 'landing_widget' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`admin_note` text,
	`notification_status` text DEFAULT 'pending' NOT NULL,
	`notification_message_id` text,
	`notification_last_error` text,
	`notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `support_tickets_status_idx` ON `support_tickets` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_preferred_at_idx` ON `support_tickets` (`preferred_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_phone_idx` ON `support_tickets` (`phone`);