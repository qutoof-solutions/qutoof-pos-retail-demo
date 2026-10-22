CREATE TABLE `customer_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`plan_id` text,
	`plan_name_snapshot` text NOT NULL,
	`price_minor_snapshot` integer DEFAULT 0 NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`frozen_days_total` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `customer_memberships_tenant_customer_idx` ON `customer_memberships` (`tenant_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `customer_memberships_tenant_branch_ends_idx` ON `customer_memberships` (`tenant_id`,`branch_id`,`ends_at`);--> statement-breakpoint
CREATE TABLE `membership_freezes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`days` integer NOT NULL,
	`old_ends_at` integer NOT NULL,
	`new_ends_at` integer NOT NULL,
	`reason` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `customer_memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_freezes_tenant_idempotency_uq` ON `membership_freezes` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `membership_freezes_membership_created_idx` ON `membership_freezes` (`tenant_id`,`membership_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quotation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`quotation_id` text NOT NULL,
	`service_id` text,
	`inventory_item_id` text,
	`warehouse_id` text,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`quantity_scale` integer DEFAULT 0 NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	`price_tier` text DEFAULT 'retail' NOT NULL,
	`commission_bps` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quotation_items_tenant_quote_idx` ON `quotation_items` (`tenant_id`,`quotation_id`);--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`created_by` text,
	`converted_invoice_id` text,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`quote_number` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`valid_until` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`converted_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_tenant_number_uq` ON `quotations` (`tenant_id`,`quote_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_tenant_idempotency_uq` ON `quotations` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_converted_invoice_uq` ON `quotations` (`tenant_id`,`converted_invoice_id`) WHERE "quotations"."converted_invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `quotations_tenant_branch_status_idx` ON `quotations` (`tenant_id`,`branch_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `wholesale_price_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `distributor_price_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `inventory_items` SET `wholesale_price_minor` = `selling_price_minor`, `distributor_price_minor` = `selling_price_minor`;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `variant_group_id` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `variant_size` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `variant_color` text;--> statement-breakpoint
CREATE INDEX `inventory_items_variant_group_idx` ON `inventory_items` (`tenant_id`,`variant_group_id`);--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `price_tier` text DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `order_type` text DEFAULT 'counter' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `delivery_customer_name` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `delivery_address` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `delivery_phone` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `courier_name` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `delivery_status` text;