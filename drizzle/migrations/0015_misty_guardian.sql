ALTER TABLE `invoice_payments` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `idempotency_payload_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_payments_tenant_idempotency_uq` ON `invoice_payments` (`tenant_id`,`idempotency_key`) WHERE "invoice_payments"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `idempotency_payload_hash` text;