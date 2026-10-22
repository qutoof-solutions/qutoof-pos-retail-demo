ALTER TABLE `appointments` ADD `reschedule_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `cancellation_lead_minutes` integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `max_reschedules` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `deposit_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `deposit_percent_bps` integer DEFAULT 0 NOT NULL;