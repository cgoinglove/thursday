-- A stop the user made ended a thread as `failed`; it has its own status now.
UPDATE `thread` SET `status` = 'cancelled', `outcome` = NULL WHERE `status` = 'failed';
