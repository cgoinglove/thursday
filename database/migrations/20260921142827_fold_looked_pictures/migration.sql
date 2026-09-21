-- `look_at` answers with a picture, and the sdk writes what a tool sent the model into the
-- transcript, so every row that looked at one kept the image inline and carried it into each
-- resume of that thread. Runs from now on store the record `execute` returned instead
-- (features/bot/bot.run storedMessages); this folds the rows written before that to the same
-- shape, which the screen draws through the file route. The files themselves are untouched.
-- Freed pages stay in the file until someone runs VACUUM, which cannot run inside a migration.
UPDATE thread_message
SET content = (
  SELECT json_group_array(
    CASE
      WHEN json_extract(part.value, '$.toolName') = 'look_at'
       AND json_extract(part.value, '$.output.type') = 'content'
       AND json_extract(part.value, '$.output.value[1].type') = 'file'
      THEN json_set(
             part.value,
             '$.output',
             json(json_object(
               'type', 'json',
               'value', json_object(
                 'path', rtrim(replace(json_extract(part.value, '$.output.value[0].text'), ', as an image:', '')),
                 'mediaType', json_extract(part.value, '$.output.value[1].mediaType')
               )
             ))
           )
      ELSE json(part.value)
    END
    ORDER BY part.key
  )
  FROM json_each(thread_message.content) part
)
WHERE json_type(content) = 'array'
  AND EXISTS (
    SELECT 1 FROM json_each(thread_message.content) probe
    WHERE json_extract(probe.value, '$.toolName') = 'look_at'
      AND json_extract(probe.value, '$.output.value[1].type') = 'file'
  );
