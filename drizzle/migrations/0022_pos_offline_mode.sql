CREATE TABLE `offline_stock_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`requested_quantity` integer NOT NULL,
	`available_quantity` integer NOT NULL,
	`shortage_quantity` integer NOT NULL,
	`quantity_scale` integer NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offline_stock_conflicts_invoice_item_warehouse_uq` ON `offline_stock_conflicts` (`tenant_id`,`invoice_id`,`item_id`,`warehouse_id`);--> statement-breakpoint
CREATE INDEX `offline_stock_conflicts_tenant_ack_created_idx` ON `offline_stock_conflicts` (`tenant_id`,`acknowledged_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `offline_stock_conflicts_branch_idx` ON `offline_stock_conflicts` (`tenant_id`,`branch_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `sync_status` text DEFAULT 'synced' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `offline_local_number` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `offline_created_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_tenant_offline_number_uq` ON `invoices` (`tenant_id`,`offline_local_number`) WHERE "invoices"."offline_local_number" IS NOT NULL;