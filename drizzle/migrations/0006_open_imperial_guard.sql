CREATE TABLE `platform_billing_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`plan_id` text NOT NULL,
	`plan_name_snapshot` text NOT NULL,
	`billing_cycle_snapshot` text NOT NULL,
	`duration_days_snapshot` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
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
CREATE INDEX `platform_billing_requests_tenant_idx` ON `platform_billing_requests` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `platform_billing_requests_status_idx` ON `platform_billing_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `platform_billing_requests_one_pending_uq` ON `platform_billing_requests` (`tenant_id`) WHERE "platform_billing_requests"."status" = 'pending_review';--> statement-breakpoint
CREATE TABLE `platform_feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `platform_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`plan_id` text,
	`invoice_number` text NOT NULL,
	`plan_name_snapshot` text NOT NULL,
	`payment_method` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`paid_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`request_id`) REFERENCES `platform_billing_requests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `platform_plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_invoices_request_uq` ON `platform_invoices` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `platform_invoices_number_uq` ON `platform_invoices` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `platform_invoices_tenant_paid_idx` ON `platform_invoices` (`tenant_id`,`paid_at`);--> statement-breakpoint
CREATE TABLE `platform_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`billing_cycle` text NOT NULL,
	`custom_days` integer,
	`price_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`features_json` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_plans_name_en_uq` ON `platform_plans` (`name_en`);--> statement-breakpoint
CREATE INDEX `platform_plans_active_idx` ON `platform_plans` (`is_active`,`price_minor`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `telegram_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`update_id` text NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_webhook_update_uq` ON `telegram_webhook_events` (`update_id`);--> statement-breakpoint
CREATE INDEX `telegram_webhook_created_idx` ON `telegram_webhook_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `platform_plan_id` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `trial_started_at` integer;--> statement-breakpoint
ALTER TABLE `tenants` ADD `subscription_ends_at` integer;--> statement-breakpoint
ALTER TABLE `tenants` ADD `frozen_from_status` text;

--> statement-breakpoint
INSERT OR IGNORE INTO `platform_settings` (`key`, `value`, `updated_at`) VALUES ('trial_days', '30', unixepoch()), ('grace_days', '3', unixepoch()), ('billing.vodafone_cash_number', '', unixepoch()), ('billing.instapay_qr_url', '', unixepoch()), ('billing.currency', 'EGP', unixepoch());
--> statement-breakpoint
INSERT OR IGNORE INTO `platform_feature_flags` (`key`, `label`, `description`, `enabled`, `updated_at`) VALUES ('maintenance_mode', 'وضع الصيانة', 'إيقاف العمليات التشغيلية مؤقتاً لكل المنشآت', 0, unixepoch()), ('public_booking', 'الحجز العام', 'إتاحة بوابة الحجز العامة', 1, unixepoch()), ('whatsapp', 'WhatsApp', 'إرسال وجدولة إشعارات WhatsApp', 1, unixepoch()), ('tenant_registration', 'تسجيل المنشآت', 'السماح بالتسجيل الجديد للمنشآت', 1, unixepoch()), ('subscription_billing', 'الفوترة والاشتراكات', 'إتاحة صفحات الاشتراك ورفع الإيصالات', 1, unixepoch());
