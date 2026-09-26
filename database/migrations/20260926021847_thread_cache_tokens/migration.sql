ALTER TABLE `thread` ADD `cache_read_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `thread` ADD `cache_write_tokens` integer DEFAULT 0 NOT NULL;