ALTER TABLE `clinical_prescriptions` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `clinical_prescriptions` ADD `cancellation_reason` text;--> statement-breakpoint
ALTER TABLE `clinical_prescriptions` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `insurance_claims` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `insurance_claims` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `insurance_claims` ADD `payload_hash` text;--> statement-breakpoint
ALTER TABLE `insurance_claims` ADD `rejection_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_claims_tenant_idempotency_uq` ON `insurance_claims` (`tenant_id`,`idempotency_key`) WHERE "insurance_claims"."idempotency_key" IS NOT NULL;