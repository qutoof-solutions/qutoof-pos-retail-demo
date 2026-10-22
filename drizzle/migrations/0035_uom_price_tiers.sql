ALTER TABLE `customers` ADD `price_tier` text NOT NULL DEFAULT 'retail' CHECK (`price_tier` IN ('retail', 'wholesale', 'distributor'));
--> statement-breakpoint
CREATE TABLE `inventory_item_units` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  `item_id` text NOT NULL REFERENCES `inventory_items`(`id`) ON DELETE cascade,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `conversion_factor` integer NOT NULL DEFAULT 1 CHECK (`conversion_factor` > 0),
  `barcode` text,
  `purchase_cost_minor` integer NOT NULL DEFAULT 0 CHECK (`purchase_cost_minor` >= 0),
  `selling_price_minor` integer NOT NULL DEFAULT 0 CHECK (`selling_price_minor` >= 0),
  `wholesale_price_minor` integer NOT NULL DEFAULT 0 CHECK (`wholesale_price_minor` >= 0),
  `distributor_price_minor` integer NOT NULL DEFAULT 0 CHECK (`distributor_price_minor` >= 0),
  `is_base` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_item_units_item_code_uq` ON `inventory_item_units` (`tenant_id`,`item_id`,`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_item_units_barcode_uq` ON `inventory_item_units` (`tenant_id`,`barcode`) WHERE `barcode` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `inventory_item_units_item_idx` ON `inventory_item_units` (`tenant_id`,`item_id`,`is_active`);
--> statement-breakpoint
INSERT INTO `inventory_item_units` (`id`,`tenant_id`,`item_id`,`code`,`name`,`conversion_factor`,`barcode`,`purchase_cost_minor`,`selling_price_minor`,`wholesale_price_minor`,`distributor_price_minor`,`is_base`,`is_active`,`created_at`,`updated_at`)
SELECT lower(hex(randomblob(16))), `tenant_id`, `id`, `unit_code`, `unit_code`, 1, barcode, default_cost_minor, selling_price_minor, wholesale_price_minor, distributor_price_minor, 1, is_active, created_at, updated_at FROM `inventory_items`;
--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `unit_id` text REFERENCES `inventory_item_units`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `unit_quantity` integer;
--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `unit_code_snapshot` text;
--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `unit_conversion_factor` integer;
--> statement-breakpoint
ALTER TABLE `purchase_invoice_lines` ADD `unit_id` text REFERENCES `inventory_item_units`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `purchase_invoice_lines` ADD `unit_quantity` integer;
--> statement-breakpoint
ALTER TABLE `purchase_invoice_lines` ADD `unit_code_snapshot` text;
--> statement-breakpoint
ALTER TABLE `purchase_invoice_lines` ADD `unit_conversion_factor` integer;
--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `unit_id` text REFERENCES `inventory_item_units`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `unit_quantity` integer;
--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `unit_code_snapshot` text;
--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `unit_conversion_factor` integer;
