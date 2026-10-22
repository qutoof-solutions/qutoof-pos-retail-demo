ALTER TABLE `platform_plans` ADD COLUMN `code` text;
--> statement-breakpoint
UPDATE `platform_plans`
SET `code` = lower(trim(replace(replace(replace(`name_en`, ' ', '_'), '-', '_'), '__', '_'))) || '_' || `billing_cycle`
WHERE `code` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_plans_code_uq` ON `platform_plans` (`code`);
