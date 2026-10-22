CREATE TABLE `staff_shifts` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `branch_id` text NOT NULL REFERENCES `branches`(`id`) ON DELETE CASCADE,
  `staff_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `department` text,
  `shift_type` text NOT NULL CHECK (`shift_type` IN ('morning', 'evening', 'night')),
  `starts_at` integer NOT NULL,
  `ends_at` integer NOT NULL,
  `max_appointments` integer NOT NULL DEFAULT 0 CHECK (`max_appointments` >= 0),
  `notes` text,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK (`ends_at` > `starts_at`)
);
CREATE INDEX `staff_shifts_tenant_range_idx` ON `staff_shifts` (`tenant_id`, `starts_at`, `ends_at`);
CREATE INDEX `staff_shifts_staff_range_idx` ON `staff_shifts` (`tenant_id`, `staff_id`, `starts_at`);
CREATE INDEX `staff_shifts_branch_range_idx` ON `staff_shifts` (`tenant_id`, `branch_id`, `starts_at`);
