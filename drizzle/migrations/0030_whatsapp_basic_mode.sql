CREATE TABLE `whatsapp_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`mode` text DEFAULT 'basic' NOT NULL,
	`basic_phone_number` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_settings_tenant_uq` ON `whatsapp_settings` (`tenant_id`);