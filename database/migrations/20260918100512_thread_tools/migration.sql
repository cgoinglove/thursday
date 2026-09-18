-- The call's `delegate` and `thread` tools became one family, a tool for each thing it
-- does. Stored tool turns keep their arguments; only the name moves, so a call's history
-- still finds the thread a line started and draws each line as what it did.
UPDATE `call_message` SET `tool` = 'thread_start' WHERE `role` = 'tool' AND `tool` = 'delegate';
--> statement-breakpoint
UPDATE `call_message` SET `tool` = CASE json_extract(`text`, '$.action')
    WHEN 'status' THEN 'thread_status'
    WHEN 'cancel' THEN 'thread_cancel'
    WHEN 'open' THEN 'thread_show'
    WHEN 'seen' THEN 'thread_seen'
    ELSE 'thread_tell'
  END
  WHERE `role` = 'tool' AND `tool` = 'thread' AND json_valid(`text`);
--> statement-breakpoint
UPDATE `call_message` SET `tool` = 'thread_tell' WHERE `role` = 'tool' AND `tool` = 'thread';
