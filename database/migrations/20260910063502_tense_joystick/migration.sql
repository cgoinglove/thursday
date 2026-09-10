-- SQLite has no conditional ALTER, so this one cannot be guarded.
ALTER TABLE `memory_fact` ADD `call_id` text REFERENCES call(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_fact_call` ON `memory_fact` (`call_id`);
