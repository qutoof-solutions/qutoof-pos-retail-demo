CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`customer_id` text NOT NULL,
	`service_id` text NOT NULL,
	`provider_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'dashboard' NOT NULL,
	`notes` text,
	`cancellation_reason` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `appointments_tenant_id_idx` ON `appointments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `appointments_calendar_idx` ON `appointments` (`tenant_id`,`starts_at`,`status`);--> statement-breakpoint
CREATE INDEX `appointments_customer_idx` ON `appointments` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `appointments_provider_idx` ON `appointments` (`tenant_id`,`provider_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`actor_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`ip_address` text,
	`user_agent` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_tenant_id_idx` ON `audit_logs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_resource_idx` ON `audit_logs` (`tenant_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`tenant_id`,`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`phone` text,
	`map_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `branches_tenant_id_idx` ON `branches` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `branches_tenant_name_uq` ON `branches` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`full_name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`notes` text,
	`date_of_birth` text,
	`gender` text DEFAULT 'unspecified' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `customers_tenant_id_idx` ON `customers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`tenant_id`,`full_name`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`customer_id` text,
	`appointment_id` text,
	`issued_by` text,
	`invoice_number` text NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`payment_method` text DEFAULT 'unpaid' NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoices_tenant_id_idx` ON `invoices` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_tenant_number_uq` ON `invoices` (`tenant_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoices_customer_idx` ON `invoices` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `patient_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`appointment_id` text,
	`author_id` text NOT NULL,
	`record_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`attachment_key` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `patient_records_tenant_id_idx` ON `patient_records` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `patient_records_customer_idx` ON `patient_records` (`tenant_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `queue_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`appointment_id` text,
	`provider_id` text,
	`ticket_number` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`display_label` text,
	`created_at` integer NOT NULL,
	`called_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `queue_tickets_tenant_id_idx` ON `queue_tickets` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_ticket_branch_number_uq` ON `queue_tickets` (`tenant_id`,`branch_id`,`ticket_number`);--> statement-breakpoint
CREATE INDEX `queue_ticket_status_idx` ON `queue_tickets` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`provider_id` text,
	`weekday` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`breaks_json` text DEFAULT '[]' NOT NULL,
	`effective_from` text,
	`effective_to` text,
	`is_available` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedules_tenant_id_idx` ON `schedules` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `schedules_provider_weekday_idx` ON `schedules` (`tenant_id`,`provider_id`,`weekday`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'single' NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`duration_minutes` integer NOT NULL,
	`provider_commission_bps` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `services_tenant_id_idx` ON `services` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `services_branch_idx` ON `services` (`tenant_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `services_active_idx` ON `services` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `shift_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`opened_by` text NOT NULL,
	`closed_by` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	`opening_cash_minor` integer DEFAULT 0 NOT NULL,
	`expected_cash_minor` integer DEFAULT 0 NOT NULL,
	`counted_cash_minor` integer,
	`cash_difference_minor` integer,
	`electronic_total_minor` integer DEFAULT 0 NOT NULL,
	`notes` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shift_settlements_tenant_id_idx` ON `shift_settlements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `shift_settlements_status_idx` ON `shift_settlements` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`billing_cycle` text NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`custom_days` integer,
	`features_json` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscription_plans_tenant_id_idx` ON `subscription_plans` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `subscription_plans_active_idx` ON `subscription_plans` (`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_plans_scope_name_uq` ON `subscription_plans` (`tenant_id`,`name_en`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`vertical` text NOT NULL,
	`status` text DEFAULT 'pending_trial' NOT NULL,
	`logo_url` text,
	`contact_email` text,
	`contact_phone` text,
	`timezone` text DEFAULT 'Africa/Cairo' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`subscription_plan_id` text,
	`trial_ends_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_uq` ON `tenants` (`slug`);--> statement-breakpoint
CREATE INDEX `tenants_status_idx` ON `tenants` (`status`);--> statement-breakpoint
CREATE INDEX `tenants_vertical_idx` ON `tenants` (`vertical`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`email_verified_at` integer,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `users_tenant_id_idx` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_email_uq` ON `users` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`tenant_id`,`role`);