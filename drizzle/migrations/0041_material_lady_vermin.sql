ALTER TABLE `branches` ADD `name_ar` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `name_en` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `branches` SET `name_ar` = `name` WHERE trim(`name_ar`) = '';--> statement-breakpoint
UPDATE `branches`
SET `name_en` = CASE
  WHEN trim(`name`) = '' THEN 'Branch ' || `id`
  WHEN `name` GLOB '*[ء-ي]*' THEN 'Branch ' || `id`
  ELSE `name`
END
WHERE trim(`name_en`) = '';--> statement-breakpoint
CREATE UNIQUE INDEX `branches_tenant_name_ar_uq` ON `branches` (`tenant_id`,`name_ar`);--> statement-breakpoint
CREATE UNIQUE INDEX `branches_tenant_name_en_uq` ON `branches` (`tenant_id`,`name_en`);
