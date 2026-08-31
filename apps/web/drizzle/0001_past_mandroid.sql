CREATE TABLE `state_transition_locks` (
	`table_id` text NOT NULL,
	`from_version` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`table_id`, `from_version`),
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wallet_mutation_locks` (
	`user_id` text NOT NULL,
	`from_version` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `from_version`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
