-- Forward-only recovery for production D1 drift where 0019/0020 are recorded
-- in d1_migrations but their schema effects are absent or stale.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `branch_memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `user_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `branch_memberships_user_branch_uq` ON `branch_memberships` (`tenant_id`,`user_id`,`branch_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `branch_memberships_user_idx` ON `branch_memberships` (`tenant_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `branch_memberships_branch_idx` ON `branch_memberships` (`tenant_id`,`branch_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `branch_memberships` (`id`, `tenant_id`, `user_id`, `branch_id`, `created_at`)
SELECT lower(hex(randomblob(16))), u.`tenant_id`, u.`id`, b.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
JOIN `branches` b ON b.`tenant_id` = u.`tenant_id` AND b.`is_active` = 1
WHERE u.`tenant_id` IS NOT NULL
  AND u.`is_active` = 1
  AND (
    u.`role` IN ('business_admin', 'owner', 'admin')
    OR (
      u.`role` IN ('provider', 'doctor', 'specialist')
      AND EXISTS (
        SELECT 1 FROM `schedules` s
        WHERE s.`tenant_id` = u.`tenant_id`
          AND s.`provider_id` = u.`id`
          AND (s.`branch_id` = b.`id` OR s.`branch_id` IS NULL)
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM `branch_memberships` m
    WHERE m.`tenant_id` = u.`tenant_id`
      AND m.`user_id` = u.`id`
      AND m.`branch_id` = b.`id`
  );
--> statement-breakpoint
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
