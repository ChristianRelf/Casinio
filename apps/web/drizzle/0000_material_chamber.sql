CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text NOT NULL,
	`ip_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_admin_audit_actor_created` ON `admin_audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`user_id` text NOT NULL,
	`hand_id` text,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `game_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bets_round_user` ON `bets` (`round_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`hand_id` text,
	`shoe_position` integer NOT NULL,
	`rank` text NOT NULL,
	`suit` text NOT NULL,
	`deck_index` integer NOT NULL,
	`dealt_at` text,
	`revealed_at` text,
	FOREIGN KEY (`round_id`) REFERENCES `game_rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_cards_round_shoe_position` ON `cards` (`round_id`,`shoe_position`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_table_created` ON `chat_messages` (`table_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `discord_identities` (
	`user_id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`username` text NOT NULL,
	`global_name` text,
	`avatar_hash` text,
	`scopes` text NOT NULL,
	`token_expires_at` text,
	`last_authenticated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_discord_identities_discord_user_id` ON `discord_identities` (`discord_user_id`);--> statement-breakpoint
CREATE TABLE `game_events` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`round_id` text,
	`state_version` integer NOT NULL,
	`event_type` text NOT NULL,
	`public_payload_json` text NOT NULL,
	`private_payload_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_game_events_table_version_id` ON `game_events` (`table_id`,`state_version`,`id`);--> statement-breakpoint
CREATE INDEX `idx_game_events_table_version` ON `game_events` (`table_id`,`state_version`);--> statement-breakpoint
CREATE TABLE `game_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`game_type` text NOT NULL,
	`status` text NOT NULL,
	`rules_json` text NOT NULL,
	`authoritative_state_json` text NOT NULL,
	`started_at` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_game_rounds_table_sequence` ON `game_rounds` (`table_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_game_rounds_table_started` ON `game_rounds` (`table_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `hands` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`user_id` text,
	`seat_number` integer,
	`hand_index` integer NOT NULL,
	`wager` integer NOT NULL,
	`status` text NOT NULL,
	`total` integer,
	`is_dealer` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `game_rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`route` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_json` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_prefix` text NOT NULL,
	`created_by` text NOT NULL,
	`max_uses` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_invite_codes_hash` ON `invite_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_invite_codes_table` ON `invite_codes` (`table_id`);--> statement-breakpoint
CREATE TABLE `player_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`round_id` text,
	`user_id` text NOT NULL,
	`action_type` text NOT NULL,
	`action_json` text NOT NULL,
	`expected_version` integer NOT NULL,
	`accepted_version` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_actions_round_created` ON `player_actions` (`round_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_started_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`permissions_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_roles_name` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `round_participants` (
	`round_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seat_number` integer NOT NULL,
	`starting_balance` integer NOT NULL,
	`ending_balance` integer,
	`outcome` text,
	PRIMARY KEY(`round_id`, `user_id`),
	FOREIGN KEY (`round_id`) REFERENCES `game_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `seats` (
	`table_id` text NOT NULL,
	`seat_number` integer NOT NULL,
	`user_id` text,
	`reserved_until` text,
	`occupied_at` text,
	PRIMARY KEY(`table_id`, `seat_number`),
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_seats_table_user` ON `seats` (`table_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`ip_hash` text,
	`user_agent` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `statistics` (
	`user_id` text PRIMARY KEY NOT NULL,
	`rounds_played` integer DEFAULT 0 NOT NULL,
	`hands_won` integer DEFAULT 0 NOT NULL,
	`hands_lost` integer DEFAULT 0 NOT NULL,
	`hands_pushed` integer DEFAULT 0 NOT NULL,
	`blackjacks` integer DEFAULT 0 NOT NULL,
	`biggest_win` integer DEFAULT 0 NOT NULL,
	`total_wagered` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `table_memberships` (
	`table_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`connection_status` text NOT NULL,
	`ready` integer DEFAULT false NOT NULL,
	`pending_bet` integer,
	`joined_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`left_at` text,
	PRIMARY KEY(`table_id`, `user_id`),
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memberships_user_id_status` ON `table_memberships` (`user_id`,`connection_status`);--> statement-breakpoint
CREATE TABLE `tables` (
	`id` text PRIMARY KEY NOT NULL,
	`game_type` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`dealer_mode` text DEFAULT 'automated' NOT NULL,
	`dealer_user_id` text,
	`max_seats` integer NOT NULL,
	`min_bet` integer NOT NULL,
	`max_bet` integer NOT NULL,
	`rules_json` text NOT NULL,
	`game_state_json` text,
	`current_round_id` text,
	`state_version` integer DEFAULT 0 NOT NULL,
	`last_event_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tables_owner_user_id` ON `tables` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_tables_status_visibility` ON `tables` (`status`,`visibility`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`granted_at` text NOT NULL,
	`granted_by` text,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`age_confirmed_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`is_development` integer DEFAULT false NOT NULL,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`table_id` text,
	`round_id` text,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`balance_before` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_wallet_ledger_idempotency` ON `wallet_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_wallet_ledger_user_created` ON `wallet_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_wallet_ledger_round` ON `wallet_ledger` (`round_id`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_refill_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
