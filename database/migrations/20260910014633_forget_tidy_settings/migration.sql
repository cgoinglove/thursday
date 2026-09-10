-- The switch and the model pick the read-back had. Nothing reads these keys now,
-- and the Config screen only draws what CONFIG_GROUPS names, so they would sit
-- in the table unseen (features/config/config.const).
DELETE FROM `config` WHERE `key` IN ('MEMORY_TIDY', 'MEMORY_TIDY_MODEL');
