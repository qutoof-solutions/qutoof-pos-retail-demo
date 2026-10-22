CREATE TABLE `data_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_import_jobs_tenant_key_uq` ON `data_import_jobs` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `data_import_jobs_tenant_created_idx` ON `data_import_jobs` (`tenant_id`,`created_at`);