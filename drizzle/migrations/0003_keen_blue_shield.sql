CREATE TABLE `customer_entitlement_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entitlement_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`used_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entitlement_id`) REFERENCES `customer_entitlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_entitlement_appointment_uq` ON `customer_entitlement_usages` (`tenant_id`,`appointment_id`);--> statement-breakpoint
CREATE INDEX `customer_entitlement_usage_tenant_idx` ON `customer_entitlement_usages` (`tenant_id`,`entitlement_id`);--> statement-breakpoint
CREATE TABLE `customer_entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`service_id` text NOT NULL,
	`invoice_item_id` text NOT NULL,
	`total_sessions` integer NOT NULL,
	`used_sessions` integer DEFAULT 0 NOT NULL,
	`valid_until` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_item_id`) REFERENCES `invoice_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_entitlements_invoice_item_uq` ON `customer_entitlements` (`tenant_id`,`invoice_item_id`);--> statement-breakpoint
CREATE INDEX `customer_entitlements_tenant_customer_idx` ON `customer_entitlements` (`tenant_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_ticket_appointment_uq` ON `queue_tickets` (`tenant_id`,`appointment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_one_active_ticket_uq` ON `queue_tickets` (`tenant_id`,`branch_id`) WHERE "queue_tickets"."status" IN ('called', 'serving');--> statement-breakpoint
CREATE UNIQUE INDEX `shift_one_open_branch_uq` ON `shift_settlements` (`tenant_id`,`branch_id`) WHERE "shift_settlements"."status" = 'open';

--> statement-breakpoint
CREATE TRIGGER `customer_entitlement_usage_validate`
BEFORE INSERT ON `customer_entitlement_usages`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_entitlements` e
  JOIN `appointments` a ON a.`id` = NEW.`appointment_id` AND a.`tenant_id` = NEW.`tenant_id`
  WHERE e.`id` = NEW.`entitlement_id`
    AND e.`tenant_id` = NEW.`tenant_id`
    AND e.`customer_id` = a.`customer_id`
    AND e.`service_id` = a.`service_id`
    AND e.`status` = 'active'
    AND e.`used_sessions` < e.`total_sessions`
    AND (e.`valid_until` IS NULL OR e.`valid_until` >= unixepoch())
)
BEGIN
  SELECT RAISE(ABORT, 'ENTITLEMENT_NOT_AVAILABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `customer_entitlement_usage_consume`
AFTER INSERT ON `customer_entitlement_usages`
BEGIN
  UPDATE `customer_entitlements`
  SET `used_sessions` = `used_sessions` + 1,
      `status` = CASE WHEN `used_sessions` + 1 >= `total_sessions` THEN 'depleted' ELSE 'active' END,
      `updated_at` = unixepoch()
  WHERE `id` = NEW.`entitlement_id` AND `tenant_id` = NEW.`tenant_id`;
END;
