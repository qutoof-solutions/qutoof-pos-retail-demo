DROP TRIGGER IF EXISTS `service_material_validate_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `service_material_validate_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `service_materials_require_warehouse_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `service_materials_require_warehouse_update`;
--> statement-breakpoint
CREATE TRIGGER `service_material_validate_insert` BEFORE INSERT ON `service_materials`
BEGIN
  SELECT CASE WHEN NEW.quantity_per_service <= 0 THEN RAISE(ABORT, 'SERVICE_MATERIAL_INVALID_QUANTITY') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `services` s
    WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_SERVICE_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_items` i
    WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_ITEM_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_warehouses` w
    WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_SCOPE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `services` s
    JOIN `inventory_warehouses` w ON w.id = NEW.warehouse_id
    WHERE s.id = NEW.service_id
      AND s.tenant_id = NEW.tenant_id
      AND s.branch_id IS NOT NULL
      AND w.branch_id IS NOT NULL
      AND s.branch_id <> w.branch_id
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_BRANCH_SCOPE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `service_material_validate_update` BEFORE UPDATE ON `service_materials`
BEGIN
  SELECT CASE WHEN NEW.warehouse_id IS NULL THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED') END;
  SELECT CASE WHEN NEW.quantity_per_service <= 0 THEN RAISE(ABORT, 'SERVICE_MATERIAL_INVALID_QUANTITY') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `services` s
    WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_SERVICE_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_items` i
    WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id AND i.is_active = 1
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_ITEM_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_warehouses` w
    WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id AND w.is_active = 1
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_SCOPE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `services` s
    JOIN `inventory_warehouses` w ON w.id = NEW.warehouse_id
    WHERE s.id = NEW.service_id
      AND s.tenant_id = NEW.tenant_id
      AND s.branch_id IS NOT NULL
      AND w.branch_id IS NOT NULL
      AND s.branch_id <> w.branch_id
  ) THEN RAISE(ABORT, 'SERVICE_MATERIAL_BRANCH_SCOPE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `service_materials_require_warehouse_insert`
BEFORE INSERT ON `service_materials`
WHEN NEW.`warehouse_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `service_materials_require_warehouse_update`
BEFORE UPDATE OF `warehouse_id` ON `service_materials`
WHEN NEW.`warehouse_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'SERVICE_MATERIAL_WAREHOUSE_REQUIRED');
END;
