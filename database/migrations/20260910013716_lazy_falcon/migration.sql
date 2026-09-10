-- Reading calls back is gone: the run log, the checkpoint on each call, and the
-- hand its writes were recorded under. Facts it wrote came out of a call, so
-- they are recorded as the call's rather than dropped (memory.schema MemorySource).
UPDATE `memory_fact` SET `source` = 'call' WHERE `source` = 'tidy';--> statement-breakpoint
DROP TABLE IF EXISTS `memory_tidy_run`;--> statement-breakpoint
-- SQLite has no conditional ALTER, so this one cannot be guarded.
ALTER TABLE `call` DROP COLUMN `tidied_at`;
