CREATE TABLE `gym_pt_session_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`session_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`actor_id` text,
	`appointment_id` text,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`consumed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `gym_pt_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gym_pt_session_usages_tenant_key_uq` ON `gym_pt_session_usages` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `gym_pt_session_usages_session_customer_idx` ON `gym_pt_session_usages` (`session_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `gym_pt_session_usages_tenant_branch_time_idx` ON `gym_pt_session_usages` (`tenant_id`,`branch_id`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `insurance_claim_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`version` integer NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`actor_id` text,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `insurance_claims`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_claim_events_claim_version_uq` ON `insurance_claim_events` (`claim_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_claim_events_tenant_key_uq` ON `insurance_claim_events` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `insurance_claim_events_tenant_claim_idx` ON `insurance_claim_events` (`tenant_id`,`claim_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invoice_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`branch_id` text,
	`adjustment_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`subtotal_delta_minor` integer DEFAULT 0 NOT NULL,
	`discount_delta_minor` integer DEFAULT 0 NOT NULL,
	`total_delta_minor` integer NOT NULL,
	`reason` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`adjusted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`adjusted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_adjustments_tenant_key_uq` ON `invoice_adjustments` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `invoice_adjustments_tenant_invoice_idx` ON `invoice_adjustments` (`tenant_id`,`invoice_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `offline_conflict_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conflict_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`action` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conflict_id`) REFERENCES `offline_stock_conflicts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offline_conflict_actions_tenant_key_uq` ON `offline_conflict_actions` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `offline_conflict_actions_tenant_conflict_idx` ON `offline_conflict_actions` (`tenant_id`,`conflict_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `z_report_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`settlement_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`generated_by` text,
	`closed_at` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`settlement_id`) REFERENCES `shift_settlements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `z_report_snapshots_tenant_settlement_uq` ON `z_report_snapshots` (`tenant_id`,`settlement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `z_report_snapshots_tenant_key_uq` ON `z_report_snapshots` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `z_report_snapshots_tenant_branch_closed_idx` ON `z_report_snapshots` (`tenant_id`,`branch_id`,`closed_at`);--> statement-breakpoint
CREATE TRIGGER `z_report_snapshots_immutable_update` BEFORE UPDATE ON `z_report_snapshots` BEGIN SELECT RAISE(ABORT, 'z_report_snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `z_report_snapshots_immutable_delete` BEFORE DELETE ON `z_report_snapshots` BEGIN SELECT RAISE(ABORT, 'z_report_snapshots are immutable'); END;--> statement-breakpoint
ALTER TABLE `gym_body_measurements` ADD `branch_id` text REFERENCES branches(id);--> statement-breakpoint
ALTER TABLE `gym_body_measurements` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `gym_body_measurements` ADD `payload_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `gym_body_measurements_tenant_key_uq` ON `gym_body_measurements` (`tenant_id`,`idempotency_key`) WHERE "gym_body_measurements"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `gym_pt_sessions` ADD `branch_id` text REFERENCES branches(id);--> statement-breakpoint
ALTER TABLE `gym_pt_sessions` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `gym_pt_sessions` ADD `payload_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `gym_pt_sessions_tenant_key_uq` ON `gym_pt_sessions` (`tenant_id`,`idempotency_key`) WHERE "gym_pt_sessions"."idempotency_key" IS NOT NULL;
