CREATE TABLE `tenant_public_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`booking_enabled` integer DEFAULT false NOT NULL,
	`accept_electronic_request` integer DEFAULT false NOT NULL,
	`google_review_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_public_profiles_tenant_uq` ON `tenant_public_profiles` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `tenant_public_profiles_tenant_id_idx` ON `tenant_public_profiles` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`phone_number_id` text NOT NULL,
	`business_account_id` text,
	`access_token_ciphertext` text NOT NULL,
	`access_token_nonce` text NOT NULL,
	`confirmation_template` text DEFAULT 'qutoof_appointment_confirmation' NOT NULL,
	`reminder_template` text DEFAULT 'qutoof_appointment_reminder' NOT NULL,
	`review_template` text DEFAULT 'qutoof_appointment_review' NOT NULL,
	`language_code` text DEFAULT 'ar' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_connections_tenant_uq` ON `whatsapp_connections` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_connections_phone_id_uq` ON `whatsapp_connections` (`phone_number_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_connections_tenant_id_idx` ON `whatsapp_connections` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`recipient_phone` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer,
	`provider_message_id` text,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_notifications_tenant_dedupe_uq` ON `whatsapp_notifications` (`tenant_id`,`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_notifications_provider_id_uq` ON `whatsapp_notifications` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_notifications_dispatch_idx` ON `whatsapp_notifications` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_notifications_tenant_appointment_idx` ON `whatsapp_notifications` (`tenant_id`,`appointment_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_webhook_tenant_event_uq` ON `whatsapp_webhook_events` (`tenant_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_tenant_created_idx` ON `whatsapp_webhook_events` (`tenant_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `public_booking_code` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `public_manage_token_hash` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `payment_preference` text DEFAULT 'cash_at_visit' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `whatsapp_opt_in` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `customer_response` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `customer_response_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_public_code_uq` ON `appointments` (`public_booking_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_manage_token_uq` ON `appointments` (`public_manage_token_hash`);