CREATE TABLE `staff_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`shift_id` text,
	`work_date` text NOT NULL,
	`clock_in` integer NOT NULL,
	`clock_out` integer,
	`total_minutes` integer DEFAULT 0 NOT NULL,
	`late_minutes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_id`) REFERENCES `staff_shifts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_attendance_staff_day_uq` ON `staff_attendance` (`tenant_id`,`staff_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `staff_attendance_branch_day_idx` ON `staff_attendance` (`tenant_id`,`branch_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `staff_attendance_shift_idx` ON `staff_attendance` (`tenant_id`,`shift_id`);