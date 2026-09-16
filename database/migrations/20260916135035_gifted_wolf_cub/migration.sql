CREATE TABLE `call_thought` (
	`call_id` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`text` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `call_thought_pk` PRIMARY KEY(`call_id`, `id`),
	CONSTRAINT `fk_call_thought_call_id_call_id_fk` FOREIGN KEY (`call_id`) REFERENCES `call`(`id`) ON DELETE CASCADE
);
