CREATE TABLE `prescription_dispenses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`prescription_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`quantity_scale` integer NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	`dispensed_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prescription_id`) REFERENCES `clinical_prescriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dispensed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prescription_dispenses_tenant_prescription_uq` ON `prescription_dispenses` (`tenant_id`,`prescription_id`);--> statement-breakpoint
CREATE INDEX `prescription_dispenses_invoice_idx` ON `prescription_dispenses` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `prescription_dispenses_item_idx` ON `prescription_dispenses` (`tenant_id`,`inventory_item_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `clinical_prescriptions` ADD `inventory_item_id` text REFERENCES inventory_items(id);--> statement-breakpoint
ALTER TABLE `clinical_prescriptions` ADD `warehouse_id` text REFERENCES inventory_warehouses(id);--> statement-breakpoint
ALTER TABLE `clinical_prescriptions` ADD `dispense_quantity` integer;--> statement-breakpoint
ALTER TABLE `clinical_prescriptions` ADD `dispense_quantity_scale` integer;