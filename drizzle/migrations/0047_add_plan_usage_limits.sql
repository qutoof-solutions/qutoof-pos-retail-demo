ALTER TABLE `platform_plans` ADD `max_users` integer;--> statement-breakpoint
ALTER TABLE `platform_plans` ADD `max_branches` integer;--> statement-breakpoint
ALTER TABLE `platform_plans` ADD `max_warehouses` integer;

-- NULL means unlimited. Backfill the six owner-approved plan quotas by stable catalog code.
UPDATE `platform_plans` SET `max_users` = 2, `max_branches` = 1, `max_warehouses` = 1
WHERE replace(replace(lower(coalesce(`code`, `name_en`)), ' ', '_'), '-', '_') LIKE 'erp_starter%'
   OR replace(replace(lower(`name_en`), ' ', '_'), '-', '_') LIKE 'erp_starter%';--> statement-breakpoint
UPDATE `platform_plans` SET `max_users` = 6, `max_branches` = 3, `max_warehouses` = 3
WHERE replace(replace(lower(coalesce(`code`, `name_en`)), ' ', '_'), '-', '_') LIKE 'erp_pro%'
   OR replace(replace(lower(`name_en`), ' ', '_'), '-', '_') LIKE 'erp_pro%';--> statement-breakpoint
UPDATE `platform_plans` SET `max_users` = 15, `max_branches` = NULL, `max_warehouses` = NULL
WHERE replace(replace(lower(coalesce(`code`, `name_en`)), ' ', '_'), '-', '_') LIKE 'erp_enterprise%'
   OR replace(replace(lower(`name_en`), ' ', '_'), '-', '_') LIKE 'erp_enterprise%';--> statement-breakpoint
UPDATE `platform_plans` SET `max_users` = 2, `max_branches` = 1, `max_warehouses` = 1
WHERE replace(replace(lower(coalesce(`code`, `name_en`)), ' ', '_'), '-', '_') LIKE 'clinic_solo%'
   OR replace(replace(lower(`name_en`), ' ', '_'), '-', '_') LIKE 'clinic_solo%';--> statement-breakpoint
UPDATE `platform_plans` SET `max_users` = 6, `max_branches` = 4, `max_warehouses` = 2
WHERE replace(replace(lower(coalesce(`code`, `name_en`)), ' ', '_'), '-', '_') LIKE 'clinic_center%'
   OR replace(replace(lower(`name_en`), ' ', '_'), '-', '_') LIKE 'clinic_center%';--> statement-breakpoint
UPDATE `platform_plans` SET `max_users` = NULL, `max_branches` = NULL, `max_warehouses` = NULL
WHERE replace(replace(lower(coalesce(`code`, `name_en`)), ' ', '_'), '-', '_') LIKE 'clinic_hospital%'
   OR replace(replace(lower(`name_en`), ' ', '_'), '-', '_') LIKE 'clinic_hospital%';
