CREATE TABLE `memory_tidy_run` (
	`id` text PRIMARY KEY,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`call_ids` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`error` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
ALTER TABLE `call` ADD `tidied_at` integer;
--> statement-breakpoint
UPDATE `call` SET `tidied_at` = `ended_at` WHERE `ended_at` IS NOT NULL;
