CREATE TABLE `distribution_customer_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`route_id` text NOT NULL,
	`sales_rep_id` text NOT NULL,
	`assigned_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`route_id`) REFERENCES `distribution_routes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sales_rep_id`) REFERENCES `sales_reps`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distribution_customer_assignments_customer_uq` ON `distribution_customer_assignments` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `distribution_customer_assignments_route_idx` ON `distribution_customer_assignments` (`tenant_id`,`route_id`);--> statement-breakpoint
CREATE INDEX `distribution_customer_assignments_rep_idx` ON `distribution_customer_assignments` (`tenant_id`,`sales_rep_id`);--> statement-breakpoint
CREATE TABLE `distribution_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`area` text NOT NULL,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distribution_routes_tenant_code_uq` ON `distribution_routes` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `distribution_routes_tenant_branch_name_uq` ON `distribution_routes` (`tenant_id`,`branch_id`,`name`);--> statement-breakpoint
CREATE INDEX `distribution_routes_tenant_branch_active_idx` ON `distribution_routes` (`tenant_id`,`branch_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `distribution_trip_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `distribution_trips`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distribution_trip_invoices_tenant_invoice_uq` ON `distribution_trip_invoices` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `distribution_trip_invoices_trip_idx` ON `distribution_trip_invoices` (`tenant_id`,`trip_id`);--> statement-breakpoint
CREATE TABLE `distribution_trip_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text,
	`batch_key` text DEFAULT '' NOT NULL,
	`quantity_scale` integer NOT NULL,
	`loaded_units` integer NOT NULL,
	`unit_cost_minor` integer NOT NULL,
	`returned_good_units` integer DEFAULT 0 NOT NULL,
	`returned_damaged_units` integer DEFAULT 0 NOT NULL,
	`missing_units` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `distribution_trips`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "distribution_trip_lines_loaded_positive" CHECK("distribution_trip_lines"."loaded_units" > 0),
	CONSTRAINT "distribution_trip_lines_returns_nonnegative" CHECK("distribution_trip_lines"."returned_good_units" >= 0 AND "distribution_trip_lines"."returned_damaged_units" >= 0 AND "distribution_trip_lines"."missing_units" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distribution_trip_lines_trip_item_batch_uq` ON `distribution_trip_lines` (`tenant_id`,`trip_id`,`item_id`,`batch_key`);--> statement-breakpoint
CREATE INDEX `distribution_trip_lines_trip_idx` ON `distribution_trip_lines` (`tenant_id`,`trip_id`);--> statement-breakpoint
CREATE TABLE `distribution_trips` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`route_id` text NOT NULL,
	`sales_rep_id` text NOT NULL,
	`source_warehouse_id` text NOT NULL,
	`van_warehouse_id` text NOT NULL,
	`trip_number` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`opened_by` text,
	`opened_at` integer DEFAULT 0 NOT NULL,
	`closed_by` text,
	`closed_at` integer,
	`expected_cash_minor` integer DEFAULT 0 NOT NULL,
	`handed_cash_minor` integer,
	`cash_difference_minor` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`route_id`) REFERENCES `distribution_routes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sales_rep_id`) REFERENCES `sales_reps`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`van_warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distribution_trips_tenant_number_uq` ON `distribution_trips` (`tenant_id`,`trip_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `distribution_trips_one_open_rep_uq` ON `distribution_trips` (`tenant_id`,`sales_rep_id`) WHERE "distribution_trips"."status" = 'open';--> statement-breakpoint
CREATE INDEX `distribution_trips_tenant_branch_created_idx` ON `distribution_trips` (`tenant_id`,`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `distribution_trips_route_created_idx` ON `distribution_trips` (`tenant_id`,`route_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sales_reps` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`route_id` text,
	`van_warehouse_id` text,
	`full_name` text NOT NULL,
	`phone` text,
	`vehicle_name` text,
	`vehicle_plate` text,
	`commission_bps` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`route_id`) REFERENCES `distribution_routes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`van_warehouse_id`) REFERENCES `inventory_warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sales_reps_commission_bps_range" CHECK("sales_reps"."commission_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_reps_tenant_van_warehouse_uq` ON `sales_reps` (`tenant_id`,`van_warehouse_id`) WHERE "sales_reps"."van_warehouse_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `sales_reps_tenant_branch_active_idx` ON `sales_reps` (`tenant_id`,`branch_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `sales_reps_route_idx` ON `sales_reps` (`tenant_id`,`route_id`);--> statement-breakpoint
CREATE TABLE `treasury_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text,
	`account_type` text NOT NULL,
	`name` text NOT NULL,
	`bank_name` text,
	`account_reference` text,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`opening_balance_minor` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "treasury_accounts_opening_nonnegative" CHECK("treasury_accounts"."opening_balance_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `treasury_accounts_tenant_branch_name_uq` ON `treasury_accounts` (`tenant_id`,`branch_id`,`name`);--> statement-breakpoint
CREATE INDEX `treasury_accounts_tenant_active_idx` ON `treasury_accounts` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `treasury_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`branch_id` text,
	`route_id` text,
	`sales_rep_id` text,
	`trip_id` text,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`is_operating_expense` integer DEFAULT false NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`idempotency_key` text NOT NULL,
	`reversal_of_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `treasury_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`route_id`) REFERENCES `distribution_routes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sales_rep_id`) REFERENCES `sales_reps`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`trip_id`) REFERENCES `distribution_trips`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reversal_of_id`) REFERENCES `treasury_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "treasury_transactions_amount_positive" CHECK("treasury_transactions"."amount_minor" > 0),
	CONSTRAINT "treasury_transactions_expense_direction" CHECK("treasury_transactions"."is_operating_expense" = 0 OR ("treasury_transactions"."direction" = 'out' OR "treasury_transactions"."reversal_of_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `treasury_transactions_tenant_idempotency_uq` ON `treasury_transactions` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `treasury_transactions_reversal_uq` ON `treasury_transactions` (`tenant_id`,`reversal_of_id`) WHERE "treasury_transactions"."reversal_of_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `treasury_transactions_tenant_created_idx` ON `treasury_transactions` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `treasury_transactions_account_created_idx` ON `treasury_transactions` (`tenant_id`,`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `treasury_transactions_route_idx` ON `treasury_transactions` (`tenant_id`,`route_id`,`created_at`);

--> statement-breakpoint
CREATE TRIGGER `treasury_transactions_no_overdraft`
BEFORE INSERT ON `treasury_transactions`
WHEN NEW.`direction` = 'out' AND COALESCE((
  SELECT a.`opening_balance_minor` + COALESCE(SUM(CASE WHEN t.`direction` = 'in' THEN t.`amount_minor` ELSE -t.`amount_minor` END), 0)
  FROM `treasury_accounts` a
  LEFT JOIN `treasury_transactions` t ON t.`tenant_id` = a.`tenant_id` AND t.`account_id` = a.`id`
  WHERE a.`id` = NEW.`account_id` AND a.`tenant_id` = NEW.`tenant_id`
), 0) < NEW.`amount_minor`
BEGIN
  SELECT RAISE(ABORT, 'TREASURY_INSUFFICIENT_FUNDS');
END;
--> statement-breakpoint
CREATE TRIGGER `treasury_transactions_immutable_update`
BEFORE UPDATE ON `treasury_transactions`
BEGIN
  SELECT RAISE(ABORT, 'TREASURY_LEDGER_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `treasury_transactions_immutable_delete`
BEFORE DELETE ON `treasury_transactions`
BEGIN
  SELECT RAISE(ABORT, 'TREASURY_LEDGER_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `distribution_trip_invoice_validate_open_trip`
BEFORE INSERT ON `distribution_trip_invoices`
WHEN NOT EXISTS (
  SELECT 1
  FROM `distribution_trips` t
  JOIN `invoices` i ON i.`id` = NEW.`invoice_id` AND i.`tenant_id` = NEW.`tenant_id`
  WHERE t.`id` = NEW.`trip_id` AND t.`tenant_id` = NEW.`tenant_id`
    AND t.`status` = 'open' AND i.`branch_id` = t.`branch_id`
    AND EXISTS (SELECT 1 FROM `invoice_items` ii WHERE ii.`tenant_id` = NEW.`tenant_id` AND ii.`invoice_id` = NEW.`invoice_id` AND ii.`inventory_item_id` IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM `invoice_items` ii WHERE ii.`tenant_id` = NEW.`tenant_id` AND ii.`invoice_id` = NEW.`invoice_id` AND ii.`inventory_item_id` IS NOT NULL AND ii.`stock_warehouse_id` <> t.`van_warehouse_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'DISTRIBUTION_TRIP_NOT_OPEN_OR_ITEMS_MISMATCH');
END;
