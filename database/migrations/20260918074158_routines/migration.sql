CREATE TABLE `routine` (
	`id` text PRIMARY KEY,
	`bot` text NOT NULL,
	`label` text NOT NULL,
	`request` text NOT NULL,
	`schedule` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `thread` ADD `routine_id` text;--> statement-breakpoint
CREATE INDEX `idx_routine_due` ON `routine` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_thread_routine` ON `thread` (`routine_id`,`created_at`);