ALTER TABLE `invoices` ADD `paid_at` integer;--> statement-breakpoint
UPDATE `invoices` SET `paid_at` = `updated_at` WHERE `status` = 'paid';
