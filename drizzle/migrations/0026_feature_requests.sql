CREATE TABLE IF NOT EXISTS `feature_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `submitted_by` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `status` text NOT NULL DEFAULT 'new',
  `admin_note` text,
  `reviewed_by` text,
  `reviewed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feature_requests_tenant_created_idx` ON `feature_requests` (`tenant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feature_requests_status_idx` ON `feature_requests` (`status`,`created_at`);
