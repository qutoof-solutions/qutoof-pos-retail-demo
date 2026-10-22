ALTER TABLE `invoice_items` ADD `signed_price_token` text;
--> statement-breakpoint
CREATE INDEX `offline_stock_conflicts_resolution_idx` ON `offline_stock_conflicts` (`tenant_id`,`resolution`,`created_at`);
