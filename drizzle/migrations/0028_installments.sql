CREATE TABLE `installment_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`branch_id` text,
	`base_total_minor` integer NOT NULL,
	`down_payment_minor` integer DEFAULT 0 NOT NULL,
	`interest_bps` integer DEFAULT 0 NOT NULL,
	`admin_fee_minor` integer DEFAULT 0 NOT NULL,
	`total_due_minor` integer NOT NULL,
	`installment_count` integer NOT NULL,
	`frequency` text NOT NULL,
	`first_due_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installment_contracts_tenant_invoice_uq` ON `installment_contracts` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `installment_contracts_tenant_status_idx` ON `installment_contracts` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `installment_contracts_customer_idx` ON `installment_contracts` (`tenant_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE TABLE `installment_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`installment_number` integer NOT NULL,
	`due_at` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`paid_at` integer,
	`paid_by` text,
	`payment_method` text,
	`reference` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `installment_contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installment_schedules_contract_number_uq` ON `installment_schedules` (`tenant_id`,`contract_id`,`installment_number`);--> statement-breakpoint
CREATE INDEX `installment_schedules_due_status_idx` ON `installment_schedules` (`tenant_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `installment_schedules_invoice_idx` ON `installment_schedules` (`tenant_id`,`invoice_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `installment_fee_minor` integer DEFAULT 0 NOT NULL;