ALTER TABLE `tenant_public_profiles` ADD `mobile_wallet_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `mobile_wallet_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `instapay_link` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `instapay_qr_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `payment_instructions` text DEFAULT '' NOT NULL;