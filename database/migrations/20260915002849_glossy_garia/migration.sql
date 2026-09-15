CREATE TABLE `bot_mcp_tool` (
	`botName` text NOT NULL,
	`tool_id` integer NOT NULL,
	CONSTRAINT `bot_mcp_tool_pk` PRIMARY KEY(`botName`, `tool_id`),
	CONSTRAINT `fk_bot_mcp_tool_botName_bot_name_fk` FOREIGN KEY (`botName`) REFERENCES `bot`(`name`) ON DELETE CASCADE,
	CONSTRAINT `fk_bot_mcp_tool_tool_id_mcp_tool_id_fk` FOREIGN KEY (`tool_id`) REFERENCES `mcp_tool`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bot` (
	`name` text PRIMARY KEY,
	`description` text NOT NULL,
	`system_prompt` text,
	`icon` text,
	`provider` text,
	`model` text,
	`compact_at` integer,
	`disabled` integer DEFAULT false NOT NULL,
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
	`fragments` text,
	`at` integer NOT NULL,
	CONSTRAINT `call_message_pk` PRIMARY KEY(`call_id`, `id`),
	CONSTRAINT `fk_call_message_call_id_call_id_fk` FOREIGN KEY (`call_id`) REFERENCES `call`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `call` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`backend_model` text,
	`started_at` integer NOT NULL,
	`ended_reason` text,
	`seconds` integer,
	`ended_at` integer
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
	`source` text,
	`call_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_memory_fact_note_id_memory_note_id_fk` FOREIGN KEY (`note_id`) REFERENCES `memory_note`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_fact_call_id_call_id_fk` FOREIGN KEY (`call_id`) REFERENCES `call`(`id`) ON DELETE SET NULL
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
CREATE TABLE `thread_delivery` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`key` text NOT NULL UNIQUE,
	`thread_id` text NOT NULL,
	`work_id` text NOT NULL,
	`speaker` text NOT NULL,
	`text` text NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_thread_delivery_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_delivery_work_id_thread_work_id_fk` FOREIGN KEY (`work_id`) REFERENCES `thread_work`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`bot` text,
	`parent` text,
	`hidden` integer DEFAULT false NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`compact` integer DEFAULT false NOT NULL,
	`note` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_thread_message_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `uq_thread_message_seq` UNIQUE(`thread_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `thread_relay` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`key` text NOT NULL UNIQUE,
	`thread_id` text NOT NULL,
	`bot` text NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`message_id` text,
	`accepted` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_thread_relay_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread` (
	`id` text PRIMARY KEY,
	`bot` text NOT NULL,
	`label` text NOT NULL,
	`request` text NOT NULL,
	`status` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`wrapped` integer DEFAULT false NOT NULL,
	`outcome` text,
	`pending` text,
	`seen` integer DEFAULT false NOT NULL,
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
CREATE TABLE `thread_work` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`bot` text NOT NULL,
	`caller` text NOT NULL,
	`parent_id` text,
	`state` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`context_budget` integer DEFAULT 0 NOT NULL,
	`result` text,
	`options` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_thread_work_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_call_message_call` ON `call_message` (`call_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_memory_fact_note` ON `memory_fact` (`note_id`,`is_latest`);--> statement-breakpoint
CREATE INDEX `idx_memory_fact_always` ON `memory_fact` (`always_load`,`is_latest`);--> statement-breakpoint
CREATE INDEX `idx_memory_fact_call` ON `memory_fact` (`call_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_delivery_inbox` ON `thread_delivery` (`work_id`,`consumed`,`id`);--> statement-breakpoint
CREATE INDEX `idx_thread_work_queue` ON `thread_work` (`thread_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_thread_work_parent` ON `thread_work` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_thread_work_running_bot` ON `thread_work` (`thread_id`,`bot`) WHERE "thread_work"."state" = 'running';