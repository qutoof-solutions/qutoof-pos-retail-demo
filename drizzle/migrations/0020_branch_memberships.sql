CREATE TABLE `branch_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branch_memberships_user_branch_uq` ON `branch_memberships` (`tenant_id`,`user_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `branch_memberships_user_idx` ON `branch_memberships` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `branch_memberships_branch_idx` ON `branch_memberships` (`tenant_id`,`branch_id`);
--> statement-breakpoint
INSERT INTO `branch_memberships` (`id`, `tenant_id`, `user_id`, `branch_id`, `created_at`)
SELECT lower(hex(randomblob(16))), u.`tenant_id`, u.`id`, b.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
JOIN `branches` b ON b.`tenant_id` = u.`tenant_id` AND b.`is_active` = 1
WHERE u.`tenant_id` IS NOT NULL
  AND u.`is_active` = 1
  AND (
    u.`role` IN ('business_admin', 'owner', 'admin')
    OR (
      u.`role` IN ('provider', 'doctor', 'specialist')
      AND EXISTS (
        SELECT 1 FROM `schedules` s
        WHERE s.`tenant_id` = u.`tenant_id`
          AND s.`provider_id` = u.`id`
          AND (s.`branch_id` = b.`id` OR s.`branch_id` IS NULL)
      )
    )
  );
