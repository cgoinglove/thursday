-- `plans/` and `projects/` both held things that end, so a model had to guess
-- between them; one section now takes both (memory.schema MEMORY_PATHS). Skipped
-- where the same name already exists under projects/, since path is unique.
UPDATE `memory_note`
SET `path` = 'projects/' || substr(`path`, 7)
WHERE `path` LIKE 'plans/%'
  AND NOT EXISTS (
    SELECT 1 FROM `memory_note` AS `other`
    WHERE `other`.`path` = 'projects/' || substr(`memory_note`.`path`, 7)
  );
