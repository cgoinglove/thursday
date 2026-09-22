DROP INDEX IF EXISTS `idx_memory_fact_always`;--> statement-breakpoint
ALTER TABLE `memory_fact` DROP COLUMN `always_load`;--> statement-breakpoint
-- The names a note went by move into its line, the one place a model reads them from now.
UPDATE `memory_note` SET `description` = `description` || ' (' || (SELECT group_concat(`value`, ', ') FROM json_each(`memory_note`.`aliases`)) || ')' WHERE `path` NOT IN ('profile', 'preferences') AND `aliases` IS NOT NULL AND json_valid(`aliases`) AND json_array_length(`aliases`) > 0;--> statement-breakpoint
ALTER TABLE `memory_note` DROP COLUMN `aliases`;