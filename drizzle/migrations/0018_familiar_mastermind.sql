CREATE TABLE `shift_settlement_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`payment_method` text NOT NULL,
	`amount_delta_minor` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settlement_id`) REFERENCES `shift_settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `shift_settlement_adjustments_idx` ON `shift_settlement_adjustments` (`tenant_id`,`settlement_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shift_settlement_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`payment_method` text NOT NULL,
	`expected_minor` integer NOT NULL,
	`collected_minor` integer NOT NULL,
	`difference_minor` integer NOT NULL,
	`invoice_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settlement_id`) REFERENCES `shift_settlements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shift_settlement_lines_method_uq` ON `shift_settlement_lines` (`tenant_id`,`settlement_id`,`payment_method`);--> statement-breakpoint
CREATE INDEX `shift_settlement_lines_settlement_idx` ON `shift_settlement_lines` (`tenant_id`,`settlement_id`);--> statement-breakpoint
UPDATE `service_materials` SET `warehouse_id` = COALESCE((SELECT w.id FROM `inventory_warehouses` w JOIN `services` s ON s.id = `service_materials`.`service_id` AND s.tenant_id = `service_materials`.`tenant_id` WHERE w.tenant_id = `service_materials`.`tenant_id` AND w.is_active = 1 AND (w.branch_id = s.branch_id OR w.branch_id IS NULL) ORDER BY CASE WHEN w.branch_id = s.branch_id THEN 0 ELSE 1 END, w.created_at, w.id LIMIT 1), (SELECT w.id FROM `inventory_warehouses` w WHERE w.tenant_id = `service_materials`.`tenant_id` AND w.is_active = 1 ORDER BY w.created_at, w.id LIMIT 1)) WHERE `warehouse_id` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_service_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`service_id` text NOT NULL,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity_per_service` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_service_materials`("id", "tenant_id", "service_id", "item_id", "warehouse_id", "quantity_per_service", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "service_id", "item_id", "warehouse_id", "quantity_per_service", "is_active", "created_at", "updated_at" FROM `service_materials`;--> statement-breakpoint
DROP TABLE `service_materials`;--> statement-breakpoint
ALTER TABLE `__new_service_materials` RENAME TO `service_materials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `service_materials_tenant_service_item_uq` ON `service_materials` (`tenant_id`,`service_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `service_materials_tenant_service_idx` ON `service_materials` (`tenant_id`,`service_id`);--> statement-breakpoint
CREATE TRIGGER `service_material_validate_insert` BEFORE INSERT ON `service_materials` BEGIN SELECT CASE WHEN NEW.quantity_per_service <= 0 THEN RAISE(ABORT, 'SERVICE_MATERIAL_INVALID_QUANTITY') END; SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM services s WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_SERVICE_SCOPE') END; SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1) THEN RAISE(ABORT, 'SERVICE_MATERIAL_ITEM_SCOPE') END; SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1) THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_SCOPE') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM services s JOIN inventory_warehouses w ON w.id = NEW.warehouse_id WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id AND s.branch_id IS NOT NULL AND w.branch_id IS NOT NULL AND s.branch_id <> w.branch_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_BRANCH_SCOPE') END; END;--> statement-breakpoint
CREATE TRIGGER `service_material_validate_update` BEFORE UPDATE ON `service_materials` BEGIN SELECT CASE WHEN NEW.warehouse_id IS NULL THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED') END; SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM services s WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_SERVICE_SCOPE') END; SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1) THEN RAISE(ABORT, 'SERVICE_MATERIAL_ITEM_SCOPE') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM services s JOIN inventory_warehouses w ON w.id = NEW.warehouse_id WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id AND s.branch_id IS NOT NULL AND w.branch_id IS NOT NULL AND s.branch_id <> w.branch_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_BRANCH_SCOPE') END; END;--> statement-breakpoint
CREATE TRIGGER `service_materials_require_warehouse_insert` BEFORE INSERT ON `service_materials` WHEN NEW.`warehouse_id` IS NULL BEGIN SELECT RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED'); END;--> statement-breakpoint
CREATE TRIGGER `service_materials_require_warehouse_update` BEFORE UPDATE OF `warehouse_id` ON `service_materials` WHEN NEW.`warehouse_id` IS NULL BEGIN SELECT RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED'); END;
