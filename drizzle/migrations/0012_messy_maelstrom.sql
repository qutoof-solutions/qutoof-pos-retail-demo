CREATE TABLE `inventory_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`batch_id` text,
	`batch_key` text DEFAULT '' NOT NULL,
	`quantity_on_hand` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_balances_tenant_item_warehouse_batch_uq` ON `inventory_balances` (`tenant_id`,`item_id`,`warehouse_id`,`batch_key`);--> statement-breakpoint
CREATE INDEX `inventory_balances_item_warehouse_idx` ON `inventory_balances` (`tenant_id`,`item_id`,`warehouse_id`);--> statement-breakpoint
CREATE INDEX `inventory_balances_warehouse_idx` ON `inventory_balances` (`tenant_id`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `inventory_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`lot_number` text NOT NULL,
	`expires_on` text,
	`received_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_batches_tenant_item_lot_uq` ON `inventory_batches` (`tenant_id`,`item_id`,`lot_number`);--> statement-breakpoint
CREATE INDEX `inventory_batches_expiry_idx` ON `inventory_batches` (`tenant_id`,`item_id`,`expires_on`);--> statement-breakpoint
CREATE INDEX `inventory_batches_received_idx` ON `inventory_batches` (`tenant_id`,`item_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text,
	`name` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`unit_code` text NOT NULL,
	`quantity_scale` integer DEFAULT 0 NOT NULL,
	`reorder_threshold` integer DEFAULT 0 NOT NULL,
	`default_cost_minor` integer DEFAULT 0 NOT NULL,
	`tracks_batches` integer DEFAULT false NOT NULL,
	`tracks_expiry` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tenant_sku_uq` ON `inventory_items` (`tenant_id`,`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tenant_barcode_uq` ON `inventory_items` (`tenant_id`,`barcode`) WHERE "inventory_items"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `inventory_items_tenant_name_idx` ON `inventory_items` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `inventory_items_tenant_active_idx` ON `inventory_items` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `inventory_warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_warehouses_tenant_code_uq` ON `inventory_warehouses` (`tenant_id`,`code`);--> statement-breakpoint
CREATE INDEX `inventory_warehouses_tenant_active_idx` ON `inventory_warehouses` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `purchase_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_invoice_id` text NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text,
	`quantity` integer NOT NULL,
	`unit_cost_minor` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `purchase_invoice_lines_tenant_invoice_idx` ON `purchase_invoice_lines` (`tenant_id`,`purchase_invoice_id`);--> statement-breakpoint
CREATE INDEX `purchase_invoice_lines_item_idx` ON `purchase_invoice_lines` (`tenant_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `purchase_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`total_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `stock_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_invoices_operation_id_unique` ON `purchase_invoices` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_invoices_supplier_number_uq` ON `purchase_invoices` (`tenant_id`,`supplier_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `purchase_invoices_tenant_created_idx` ON `purchase_invoices` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchase_invoices_supplier_balance_idx` ON `purchase_invoices` (`tenant_id`,`supplier_id`,`status`);--> statement-breakpoint
CREATE TABLE `service_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`service_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity_per_service` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_materials_tenant_service_item_uq` ON `service_materials` (`tenant_id`,`service_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `service_materials_tenant_service_idx` ON `service_materials` (`tenant_id`,`service_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`batch_id` text,
	`movement_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`unit_cost_minor` integer,
	`reference_type` text,
	`reference_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `stock_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stock_movements_tenant_item_created_idx` ON `stock_movements` (`tenant_id`,`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_tenant_warehouse_created_idx` ON `stock_movements` (`tenant_id`,`warehouse_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_operation_idx` ON `stock_movements` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_reference_idx` ON `stock_movements` (`tenant_id`,`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `stock_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`created_by` text,
	`notes` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_operations_tenant_idempotency_uq` ON `stock_operations` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `stock_operations_tenant_created_idx` ON `stock_operations` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_operations_reference_idx` ON `stock_operations` (`tenant_id`,`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`purchase_invoice_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`payment_method` text NOT NULL,
	`reference` text,
	`received_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_payments_tenant_idempotency_uq` ON `supplier_payments` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `supplier_payments_invoice_idx` ON `supplier_payments` (`tenant_id`,`purchase_invoice_id`);--> statement-breakpoint
CREATE INDEX `supplier_payments_supplier_idx` ON `supplier_payments` (`tenant_id`,`supplier_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_name` text,
	`phone` text,
	`email` text,
	`address` text,
	`tax_number` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suppliers_tenant_name_idx` ON `suppliers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `suppliers_tenant_active_idx` ON `suppliers` (`tenant_id`,`is_active`);

--> statement-breakpoint
CREATE TRIGGER `inventory_movement_validate_insert`
BEFORE INSERT ON `stock_movements`
BEGIN
  SELECT CASE WHEN NEW.quantity_delta = 0 THEN RAISE(ABORT, 'INVENTORY_ZERO_MOVEMENT') END;
  SELECT CASE WHEN NEW.unit_cost_minor IS NOT NULL AND NEW.unit_cost_minor < 0 THEN RAISE(ABORT, 'INVENTORY_NEGATIVE_COST') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stock_operations o WHERE o.id = NEW.operation_id AND o.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'INVENTORY_OPERATION_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1) THEN RAISE(ABORT, 'INVENTORY_ITEM_SCOPE_OR_INACTIVE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1) THEN RAISE(ABORT, 'INVENTORY_WAREHOUSE_SCOPE_OR_INACTIVE') END;
  SELECT CASE WHEN (SELECT tracks_batches FROM inventory_items WHERE id = NEW.item_id) = 1 AND NEW.batch_id IS NULL THEN RAISE(ABORT, 'INVENTORY_BATCH_REQUIRED') END;
  SELECT CASE WHEN (SELECT tracks_batches FROM inventory_items WHERE id = NEW.item_id) = 0 AND NEW.batch_id IS NOT NULL THEN RAISE(ABORT, 'INVENTORY_BATCH_NOT_ALLOWED') END;
  SELECT CASE WHEN NEW.batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_batches b WHERE b.id = NEW.batch_id AND b.tenant_id = NEW.tenant_id AND b.item_id = NEW.item_id) THEN RAISE(ABORT, 'INVENTORY_BATCH_SCOPE') END;
  SELECT CASE WHEN (SELECT tracks_expiry FROM inventory_items WHERE id = NEW.item_id) = 1 AND (NEW.batch_id IS NULL OR NOT EXISTS (SELECT 1 FROM inventory_batches b WHERE b.id = NEW.batch_id AND b.expires_on IS NOT NULL)) THEN RAISE(ABORT, 'INVENTORY_EXPIRY_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_balances b WHERE b.tenant_id = NEW.tenant_id AND b.item_id = NEW.item_id AND b.warehouse_id = NEW.warehouse_id AND b.batch_key = COALESCE(NEW.batch_id, '')) THEN RAISE(ABORT, 'INVENTORY_BALANCE_MISSING') END;
  SELECT CASE WHEN NEW.quantity_delta < 0 AND COALESCE((SELECT b.quantity_on_hand FROM inventory_balances b WHERE b.tenant_id = NEW.tenant_id AND b.item_id = NEW.item_id AND b.warehouse_id = NEW.warehouse_id AND b.batch_key = COALESCE(NEW.batch_id, '')), 0) < -NEW.quantity_delta THEN RAISE(ABORT, 'INVENTORY_INSUFFICIENT_STOCK') END;
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_movement_apply_balance`
AFTER INSERT ON `stock_movements`
BEGIN
  UPDATE inventory_balances SET quantity_on_hand = quantity_on_hand + NEW.quantity_delta, updated_at = unixepoch() WHERE tenant_id = NEW.tenant_id AND item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id AND batch_key = COALESCE(NEW.batch_id, '');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_balance_nonnegative_update`
BEFORE UPDATE OF quantity_on_hand ON `inventory_balances`
WHEN NEW.quantity_on_hand < 0
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_NEGATIVE_STOCK');
END;
--> statement-breakpoint
CREATE TRIGGER `stock_movements_immutable_update`
BEFORE UPDATE ON `stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LEDGER_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `stock_movements_immutable_delete`
BEFORE DELETE ON `stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LEDGER_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payment_validate_insert`
BEFORE INSERT ON `supplier_payments`
BEGIN
  SELECT CASE WHEN NEW.amount_minor <= 0 THEN RAISE(ABORT, 'SUPPLIER_PAYMENT_INVALID_AMOUNT') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = NEW.supplier_id AND s.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'SUPPLIER_PAYMENT_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM purchase_invoices p WHERE p.id = NEW.purchase_invoice_id AND p.tenant_id = NEW.tenant_id AND p.supplier_id = NEW.supplier_id AND p.status = 'received' AND NEW.amount_minor <= p.total_minor - p.paid_minor) THEN RAISE(ABORT, 'SUPPLIER_PAYMENT_EXCEEDS_BALANCE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payment_apply_invoice_balance`
AFTER INSERT ON `supplier_payments`
BEGIN
  UPDATE purchase_invoices SET paid_minor = paid_minor + NEW.amount_minor WHERE id = NEW.purchase_invoice_id AND tenant_id = NEW.tenant_id;
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_invoice_validate_insert`
BEFORE INSERT ON `purchase_invoices`
BEGIN
  SELECT CASE WHEN NEW.total_minor <= 0 OR NEW.paid_minor < 0 OR NEW.paid_minor > NEW.total_minor THEN RAISE(ABORT, 'PURCHASE_INVOICE_INVALID_TOTAL') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = NEW.supplier_id AND s.tenant_id = NEW.tenant_id AND s.is_active = 1) THEN RAISE(ABORT, 'PURCHASE_SUPPLIER_SCOPE_OR_INACTIVE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1) THEN RAISE(ABORT, 'PURCHASE_WAREHOUSE_SCOPE_OR_INACTIVE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stock_operations o WHERE o.id = NEW.operation_id AND o.tenant_id = NEW.tenant_id AND o.operation_type = 'purchase_receipt') THEN RAISE(ABORT, 'PURCHASE_OPERATION_SCOPE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_invoice_line_validate_insert`
BEFORE INSERT ON `purchase_invoice_lines`
BEGIN
  SELECT CASE WHEN NEW.quantity <= 0 OR NEW.unit_cost_minor < 0 OR NEW.line_total_minor <= 0 THEN RAISE(ABORT, 'PURCHASE_LINE_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM purchase_invoices p WHERE p.id = NEW.purchase_invoice_id AND p.tenant_id = NEW.tenant_id AND p.status = 'received') THEN RAISE(ABORT, 'PURCHASE_LINE_INVOICE_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'PURCHASE_LINE_ITEM_SCOPE') END;
  SELECT CASE WHEN NEW.batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_batches b WHERE b.id = NEW.batch_id AND b.tenant_id = NEW.tenant_id AND b.item_id = NEW.item_id) THEN RAISE(ABORT, 'PURCHASE_LINE_BATCH_SCOPE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `service_material_validate_insert`
BEFORE INSERT ON `service_materials`
BEGIN
  SELECT CASE WHEN NEW.quantity_per_service <= 0 THEN RAISE(ABORT, 'SERVICE_MATERIAL_INVALID_QUANTITY') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM services s WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_SERVICE_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1) THEN RAISE(ABORT, 'SERVICE_MATERIAL_ITEM_SCOPE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_item_validate_insert`
BEFORE INSERT ON `inventory_items`
BEGIN
  SELECT CASE WHEN NEW.quantity_scale < 0 OR NEW.quantity_scale > 4 THEN RAISE(ABORT, 'INVENTORY_SCALE_OUT_OF_RANGE') END;
  SELECT CASE WHEN NEW.reorder_threshold < 0 OR NEW.default_cost_minor < 0 THEN RAISE(ABORT, 'INVENTORY_ITEM_NEGATIVE_VALUE') END;
  SELECT CASE WHEN NEW.tracks_expiry = 1 AND NEW.tracks_batches = 0 THEN RAISE(ABORT, 'INVENTORY_EXPIRY_REQUIRES_BATCHES') END;
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_item_validate_update`
BEFORE UPDATE OF quantity_scale, reorder_threshold, default_cost_minor, tracks_batches, tracks_expiry ON `inventory_items`
BEGIN
  SELECT CASE WHEN NEW.quantity_scale < 0 OR NEW.quantity_scale > 4 THEN RAISE(ABORT, 'INVENTORY_SCALE_OUT_OF_RANGE') END;
  SELECT CASE WHEN NEW.reorder_threshold < 0 OR NEW.default_cost_minor < 0 THEN RAISE(ABORT, 'INVENTORY_ITEM_NEGATIVE_VALUE') END;
  SELECT CASE WHEN NEW.tracks_expiry = 1 AND NEW.tracks_batches = 0 THEN RAISE(ABORT, 'INVENTORY_EXPIRY_REQUIRES_BATCHES') END;
END;
