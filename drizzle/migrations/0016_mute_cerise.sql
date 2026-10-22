CREATE TABLE `clinical_encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`appointment_id` text,
	`practitioner_id` text NOT NULL,
	`author_id` text NOT NULL,
	`vitals_json` text DEFAULT '{}' NOT NULL,
	`allergies_text` text DEFAULT '' NOT NULL,
	`problems_json` text DEFAULT '[]' NOT NULL,
	`assessment` text NOT NULL,
	`plan` text NOT NULL,
	`follow_up` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`practitioner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `clinical_encounters_tenant_customer_idx` ON `clinical_encounters` (`tenant_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `clinical_encounters_appointment_idx` ON `clinical_encounters` (`tenant_id`,`appointment_id`);--> statement-breakpoint
CREATE INDEX `clinical_encounters_practitioner_idx` ON `clinical_encounters` (`tenant_id`,`practitioner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `clinical_prescriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`author_id` text NOT NULL,
	`medicine_name` text NOT NULL,
	`dose` text NOT NULL,
	`dose_unit` text NOT NULL,
	`frequency` text NOT NULL,
	`duration` text NOT NULL,
	`duration_unit` text NOT NULL,
	`route` text NOT NULL,
	`warnings` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`encounter_id`) REFERENCES `clinical_encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `clinical_prescriptions_tenant_encounter_idx` ON `clinical_prescriptions` (`tenant_id`,`encounter_id`);--> statement-breakpoint
CREATE INDEX `clinical_prescriptions_customer_idx` ON `clinical_prescriptions` (`tenant_id`,`customer_id`,`created_at`);