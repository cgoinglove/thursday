CREATE TABLE `bot_mcp_tool` (
	`botName` text NOT NULL,
	`tool_id` integer NOT NULL,
	CONSTRAINT `bot_mcp_tool_pk` PRIMARY KEY(`botName`, `tool_id`),
	CONSTRAINT `fk_bot_mcp_tool_botName_bot_name_fk` FOREIGN KEY (`botName`) REFERENCES `bot`(`name`) ON DELETE CASCADE,
	CONSTRAINT `fk_bot_mcp_tool_tool_id_mcp_tool_id_fk` FOREIGN KEY (`tool_id`) REFERENCES `mcp_tool`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bot_note` (
	`bot` text PRIMARY KEY,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot` (
	`name` text PRIMARY KEY,
	`description` text NOT NULL,
	`system_prompt` text,
	`icon` text,
	`provider` text,
	`model` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `call_message` (
	`call_id` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`tool` text,
	`text` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `call_message_pk` PRIMARY KEY(`call_id`, `id`),
	CONSTRAINT `fk_call_message_call_id_call_id_fk` FOREIGN KEY (`call_id`) REFERENCES `call`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `call` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`tidied_at` integer
);
--> statement-breakpoint
CREATE TABLE `config` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_server` (
	`name` text PRIMARY KEY,
	`config` text NOT NULL,
	`tools_synced_at` integer NOT NULL,
	`last_error` text,
	`oauth` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_tool` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`server_name` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`input_schema` text,
	`output_schema` text,
	CONSTRAINT `fk_mcp_tool_server_name_mcp_server_name_fk` FOREIGN KEY (`server_name`) REFERENCES `mcp_server`(`name`) ON DELETE CASCADE,
	CONSTRAINT `uq_mcp_tool_server_name` UNIQUE(`server_name`,`name`)
);
--> statement-breakpoint
CREATE TABLE `memory_fact` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`note_id` integer NOT NULL,
	`text` text NOT NULL,
	`is_latest` integer DEFAULT true NOT NULL,
	`always_load` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_memory_fact_note_id_memory_note_id_fk` FOREIGN KEY (`note_id`) REFERENCES `memory_note`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memory_note` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`path` text NOT NULL UNIQUE,
	`description` text NOT NULL,
	`aliases` text DEFAULT '[]',
	`owned_by_user` integer DEFAULT false NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`last_read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_tidy_run` (
	`id` text PRIMARY KEY,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`call_ids` text NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`error` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE TABLE `task_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`task_id` text NOT NULL,
	`seq` integer NOT NULL,
	`bot` text,
	`parent` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`compact` integer DEFAULT false NOT NULL,
	`note` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_task_message_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `uq_task_message_seq` UNIQUE(`task_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY,
	`bot` text NOT NULL,
	`label` text NOT NULL,
	`request` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`pending` text,
	`reported` integer DEFAULT false NOT NULL,
	`call_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`context_tokens` integer DEFAULT 0 NOT NULL,
	`context_budget` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_call_message_call` ON `call_message` (`call_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_memory_fact_note` ON `memory_fact` (`note_id`,`is_latest`);--> statement-breakpoint
CREATE INDEX `idx_memory_fact_always` ON `memory_fact` (`always_load`,`is_latest`);