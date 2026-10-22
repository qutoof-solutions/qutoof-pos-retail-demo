DROP INDEX `users_tenant_email_uq`;--> statement-breakpoint
DROP INDEX `users_email_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);