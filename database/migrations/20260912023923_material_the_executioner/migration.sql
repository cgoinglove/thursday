CREATE TABLE `task_delivery` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`key` text NOT NULL UNIQUE,
	`task_id` text NOT NULL,
	`work_id` text NOT NULL,
	`speaker` text NOT NULL,
	`text` text NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_task_delivery_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_delivery_work_id_task_work_id_fk` FOREIGN KEY (`work_id`) REFERENCES `task_work`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_relay` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`key` text NOT NULL UNIQUE,
	`task_id` text NOT NULL,
	`bot` text NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`message_id` text,
	`accepted` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_task_relay_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_work` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`bot` text NOT NULL,
	`caller` text NOT NULL,
	`parent_id` text,
	`state` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_task_work_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `task_message` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `turns` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `wrapped` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_task_delivery_inbox` ON `task_delivery` (`work_id`,`consumed`,`id`);--> statement-breakpoint
CREATE INDEX `idx_task_work_queue` ON `task_work` (`task_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_work_parent` ON `task_work` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_task_work_running_bot` ON `task_work` (`task_id`,`bot`) WHERE "task_work"."state" = 'running';