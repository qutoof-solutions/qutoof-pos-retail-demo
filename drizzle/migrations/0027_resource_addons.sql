CREATE TABLE `platform_addon_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`plan_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`addon_name_snapshot` text NOT NULL,
	`billing_cycle_snapshot` text NOT NULL,
	`custom_days_snapshot` integer,
	`quantity` integer NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`subscription_end_snapshot` integer NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`payment_method` text NOT NULL,
	`receipt_object_key` text NOT NULL,
	`receipt_content_type` text NOT NULL,
	`receipt_size` integer NOT NULL,
	`receipt_sha256` text NOT NULL,
	`rejection_reason` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`approval_token` text,
	`invoice_number` text,
	`telegram_message_id` text,
	`telegram_sent_at` integer,
	`telegram_attempts` integer DEFAULT 0 NOT NULL,
	`telegram_lease_until` integer,
	`telegram_last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `platform_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `platform_addon_requests_tenant_idx` ON `platform_addon_requests` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `platform_addon_requests_status_idx` ON `platform_addon_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `platform_addon_requests_one_pending_uq` ON `platform_addon_requests` (`tenant_id`) WHERE "platform_addon_requests"."status" = 'pending_review';--> statement-breakpoint
CREATE UNIQUE INDEX `platform_addon_requests_invoice_uq` ON `platform_addon_requests` (`invoice_number`) WHERE "platform_addon_requests"."invoice_number" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `tenant_resource_addons` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`baseline_count` integer NOT NULL,
	`baseline_user_count` integer DEFAULT 0 NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`request_id`) REFERENCES `platform_addon_requests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_resource_addons_request_uq` ON `tenant_resource_addons` (`request_id`);--> statement-breakpoint
CREATE INDEX `tenant_resource_addons_scope_idx` ON `tenant_resource_addons` (`tenant_id`,`resource_type`,`ends_at`);
--> statement-breakpoint
INSERT INTO `platform_plans` (`id`, `name_ar`, `name_en`, `billing_cycle`, `custom_days`, `price_minor`, `currency`, `features_json`, `is_active`, `created_at`, `updated_at`)
SELECT 'resource-addon-warehouse-monthly', 'مخزن إضافي', 'extra_warehouse_monthly', 'monthly', NULL, 15000, 'EGP', '{"catalog_addon_warehouse":true}', 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM `platform_plans` WHERE `features_json` LIKE '%"catalog_addon_warehouse":true%' OR `name_en` = 'extra_warehouse_monthly');
--> statement-breakpoint
INSERT INTO `platform_plans` (`id`, `name_ar`, `name_en`, `billing_cycle`, `custom_days`, `price_minor`, `currency`, `features_json`, `is_active`, `created_at`, `updated_at`)
SELECT 'resource-addon-branch-monthly', 'فرع إضافي', 'extra_branch_monthly', 'monthly', NULL, 25000, 'EGP', '{"catalog_addon_branch":true}', 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM `platform_plans` WHERE `features_json` LIKE '%"catalog_addon_branch":true%' OR `name_en` = 'extra_branch_monthly');
--> statement-breakpoint
INSERT INTO `platform_plans` (`id`, `name_ar`, `name_en`, `billing_cycle`, `custom_days`, `price_minor`, `currency`, `features_json`, `is_active`, `created_at`, `updated_at`)
SELECT 'resource-addon-user-monthly', 'مستخدم / كاشير إضافي', 'extra_user_monthly', 'monthly', NULL, 7500, 'EGP', '{"catalog_addon_user":true}', 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM `platform_plans` WHERE `features_json` LIKE '%"catalog_addon_user":true%' OR `name_en` = 'extra_user_monthly');
--> statement-breakpoint
INSERT INTO `platform_plans` (`id`, `name_ar`, `name_en`, `billing_cycle`, `custom_days`, `price_minor`, `currency`, `features_json`, `is_active`, `created_at`, `updated_at`)
SELECT 'resource-addon-doctor-monthly', 'طبيب إضافي', 'extra_doctor_monthly', 'monthly', NULL, 20000, 'EGP', '{"catalog_addon_doctor":true}', 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM `platform_plans` WHERE `features_json` LIKE '%"catalog_addon_doctor":true%' OR `name_en` = 'extra_doctor_monthly');
