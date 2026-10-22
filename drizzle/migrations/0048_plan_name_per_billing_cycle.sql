DROP INDEX `platform_plans_name_en_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `platform_plans_name_en_cycle_uq` ON `platform_plans` (`name_en`,`billing_cycle`);