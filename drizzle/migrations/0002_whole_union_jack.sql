CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`service_id` text,
	`provider_id` text,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	`commission_bps` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoice_items_tenant_invoice_idx` ON `invoice_items` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`received_by` text,
	`amount_minor` integer NOT NULL,
	`payment_method` text NOT NULL,
	`reference` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoice_payments_tenant_invoice_idx` ON `invoice_payments` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_payments_tenant_method_idx` ON `invoice_payments` (`tenant_id`,`payment_method`,`created_at`);--> statement-breakpoint
CREATE TABLE `schedule_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`provider_id` text,
	`date` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`reason` text NOT NULL,
	`is_emergency` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `schedule_exceptions_tenant_date_idx` ON `schedule_exceptions` (`tenant_id`,`date`,`branch_id`);--> statement-breakpoint
CREATE INDEX `schedule_exceptions_provider_idx` ON `schedule_exceptions` (`tenant_id`,`provider_id`,`date`);--> statement-breakpoint
ALTER TABLE `services` ADD `session_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `validity_days` integer;

--> statement-breakpoint
CREATE TRIGGER `appointments_provider_overlap_insert`
BEFORE INSERT ON `appointments`
WHEN NEW.`provider_id` IS NOT NULL
  AND NEW.`status` IN ('pending', 'confirmed', 'waiting', 'in_progress')
  AND EXISTS (
    SELECT 1 FROM `appointments` a
    WHERE a.`tenant_id` = NEW.`tenant_id`
      AND a.`provider_id` = NEW.`provider_id`
      AND a.`id` <> NEW.`id`
      AND a.`status` IN ('pending', 'confirmed', 'waiting', 'in_progress')
      AND a.`starts_at` < NEW.`ends_at`
      AND a.`ends_at` > NEW.`starts_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_PROVIDER_OVERLAP');
END;
--> statement-breakpoint
CREATE TRIGGER `appointments_provider_overlap_update`
BEFORE UPDATE OF `provider_id`, `starts_at`, `ends_at`, `status` ON `appointments`
WHEN NEW.`provider_id` IS NOT NULL
  AND NEW.`status` IN ('pending', 'confirmed', 'waiting', 'in_progress')
  AND EXISTS (
    SELECT 1 FROM `appointments` a
    WHERE a.`tenant_id` = NEW.`tenant_id`
      AND a.`provider_id` = NEW.`provider_id`
      AND a.`id` <> NEW.`id`
      AND a.`status` IN ('pending', 'confirmed', 'waiting', 'in_progress')
      AND a.`starts_at` < NEW.`ends_at`
      AND a.`ends_at` > NEW.`starts_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_PROVIDER_OVERLAP');
END;
