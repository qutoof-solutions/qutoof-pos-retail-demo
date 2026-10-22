ALTER TABLE `inventory_items` ADD `selling_price_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `inventory_item_id` text REFERENCES inventory_items(id);--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `stock_warehouse_id` text REFERENCES inventory_warehouses(id);--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `quantity_scale` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `invoice_items_inventory_item_idx` ON `invoice_items` (`tenant_id`,`inventory_item_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_tenant_idempotency_uq` ON `invoices` (`tenant_id`,`idempotency_key`) WHERE "invoices"."idempotency_key" IS NOT NULL;

--> statement-breakpoint
CREATE TRIGGER `invoice_item_validate_inventory_insert`
BEFORE INSERT ON `invoice_items`
BEGIN
  SELECT CASE WHEN NEW.quantity <= 0 OR NEW.unit_price_minor < 0 OR NEW.line_total_minor < 0 THEN RAISE(ABORT, 'INVOICE_ITEM_INVALID') END;
  SELECT CASE WHEN NEW.inventory_item_id IS NULL AND (NEW.stock_warehouse_id IS NOT NULL OR NEW.quantity_scale <> 0) THEN RAISE(ABORT, 'INVOICE_ITEM_TYPE_INVALID') END;
  SELECT CASE WHEN NEW.inventory_item_id IS NOT NULL AND (NEW.service_id IS NOT NULL OR NEW.provider_id IS NOT NULL OR NEW.stock_warehouse_id IS NULL) THEN RAISE(ABORT, 'INVOICE_ITEM_TYPE_INVALID') END;
  SELECT CASE WHEN NEW.inventory_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.inventory_item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1 AND i.quantity_scale = NEW.quantity_scale AND i.selling_price_minor = NEW.unit_price_minor) THEN RAISE(ABORT, 'INVOICE_ITEM_INVENTORY_SCOPE_OR_PRICE') END;
  SELECT CASE WHEN NEW.stock_warehouse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_warehouses w JOIN invoices inv ON inv.id = NEW.invoice_id AND inv.tenant_id = NEW.tenant_id WHERE w.id = NEW.stock_warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1 AND (w.branch_id IS NULL OR w.branch_id = inv.branch_id)) THEN RAISE(ABORT, 'INVOICE_ITEM_WAREHOUSE_SCOPE') END;
END;
