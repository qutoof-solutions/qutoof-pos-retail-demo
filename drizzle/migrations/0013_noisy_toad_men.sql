ALTER TABLE `service_materials` ADD `warehouse_id` text REFERENCES inventory_warehouses(id);

--> statement-breakpoint
CREATE TRIGGER `service_material_validate_warehouse_insert`
BEFORE INSERT ON `service_materials`
BEGIN
  SELECT CASE WHEN NEW.warehouse_id IS NULL THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1) THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_SCOPE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM services s JOIN inventory_warehouses w ON w.id = NEW.warehouse_id WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id AND s.branch_id IS NOT NULL AND w.branch_id IS NOT NULL AND s.branch_id <> w.branch_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_BRANCH_SCOPE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `service_material_validate_warehouse_update`
BEFORE UPDATE ON `service_materials`
BEGIN
  SELECT CASE WHEN NEW.warehouse_id IS NULL THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1) THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM services s WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_SERVICE_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1) THEN RAISE(ABORT, 'SERVICE_MATERIAL_ITEM_SCOPE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM services s JOIN inventory_warehouses w ON w.id = NEW.warehouse_id WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id AND s.branch_id IS NOT NULL AND w.branch_id IS NOT NULL AND s.branch_id <> w.branch_id) THEN RAISE(ABORT, 'SERVICE_MATERIAL_BRANCH_SCOPE') END;
END;
