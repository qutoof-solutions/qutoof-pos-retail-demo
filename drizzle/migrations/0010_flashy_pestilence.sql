CREATE TABLE `worker_heartbeats` (
	`worker_name` text PRIMARY KEY NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_status` text NOT NULL,
	`last_job_name` text NOT NULL,
	`last_run_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worker_job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_name` text NOT NULL,
	`job_name` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_at` integer,
	`http_status` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `worker_job_runs_created_idx` ON `worker_job_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `worker_job_runs_worker_created_idx` ON `worker_job_runs` (`worker_name`,`created_at`);