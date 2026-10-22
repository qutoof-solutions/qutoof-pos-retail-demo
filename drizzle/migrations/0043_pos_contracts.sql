ALTER TABLE `distribution_trips` ADD `route_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `distribution_trips` ADD `sales_rep_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `distribution_trips` ADD `vehicle_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `distribution_trips` ADD `vehicle_plate_snapshot` text;--> statement-breakpoint
ALTER TABLE `offline_stock_conflicts` ADD `resolution` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `offline_stock_conflicts` ADD `replacement_quantity` integer;--> statement-breakpoint
ALTER TABLE `offline_stock_conflicts` ADD `replacement_warehouse_id` text;--> statement-breakpoint
ALTER TABLE `offline_stock_conflicts` ADD `resolution_note` text;--> statement-breakpoint
ALTER TABLE `offline_stock_conflicts` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `offline_stock_conflicts` ADD `resolved_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `unit_id` text REFERENCES inventory_item_units(id);--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `unit_code_snapshot` text;--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `unit_conversion_factor` integer;--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `price_snapshot_minor` integer;