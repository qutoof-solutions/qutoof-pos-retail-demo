CREATE TABLE `digital_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`branch_id` text,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`checked_in_at` integer,
	`checked_in_by` text,
	`check_in_method` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checked_in_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digital_tickets_appointment_uq` ON `digital_tickets` (`tenant_id`,`appointment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `digital_tickets_token_hash_uq` ON `digital_tickets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `digital_tickets_gate_idx` ON `digital_tickets` (`tenant_id`,`branch_id`,`status`,`expires_at`);