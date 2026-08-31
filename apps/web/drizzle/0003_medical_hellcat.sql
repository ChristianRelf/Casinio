ALTER TABLE `discord_table_links` ADD `last_status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `discord_table_links` ADD `last_round_id` text;--> statement-breakpoint
ALTER TABLE `discord_table_links` ADD `last_seated_count` integer DEFAULT 0 NOT NULL;