CREATE TABLE `insurance_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`claim_month` text NOT NULL,
	`gross_minor` integer NOT NULL,
	`patient_due_minor` integer NOT NULL,
	`claim_minor` integer NOT NULL,
	`member_number` text,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `insurance_contracts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_claims_tenant_invoice_uq` ON `insurance_claims` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `insurance_claims_tenant_month_idx` ON `insurance_claims` (`tenant_id`,`claim_month`,`status`);--> statement-breakpoint
CREATE TABLE `insurance_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`contract_type` text DEFAULT 'insurance' NOT NULL,
	`discount_bps` integer DEFAULT 0 NOT NULL,
	`copay_bps` integer DEFAULT 10000 NOT NULL,
	`member_number_label` text DEFAULT 'رقم العضوية' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insurance_contracts_tenant_active_idx` ON `insurance_contracts` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_contracts_tenant_name_uq` ON `insurance_contracts` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `lab_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`encounter_id` text,
	`practitioner_id` text NOT NULL,
	`request_type` text NOT NULL,
	`tests_json` text DEFAULT '[]' NOT NULL,
	`clinical_notes` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`encounter_id`) REFERENCES `clinical_encounters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`practitioner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `lab_requests_tenant_customer_idx` ON `lab_requests` (`tenant_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `lab_requests_tenant_status_idx` ON `lab_requests` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `prescription_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`practitioner_id` text NOT NULL,
	`name` text NOT NULL,
	`items_json` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practitioner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prescription_templates_tenant_practitioner_idx` ON `prescription_templates` (`tenant_id`,`practitioner_id`,`is_active`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `visit_type` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `follow_up_of_appointment_id` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `follow_up_eligible` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `commission_mode` text DEFAULT 'percentage' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `commission_fixed_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `insurance_contract_id` text REFERENCES insurance_contracts(id);--> statement-breakpoint
ALTER TABLE `invoices` ADD `insurance_gross_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `insurance_patient_due_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `insurance_claim_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `insurance_member_number` text;--> statement-breakpoint
ALTER TABLE `services` ADD `provider_commission_mode` text DEFAULT 'percentage' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `provider_commission_fixed_minor` integer DEFAULT 0 NOT NULL;