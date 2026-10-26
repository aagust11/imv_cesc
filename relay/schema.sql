CREATE TABLE `relay_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`secret` text NOT NULL,
	`packet` text NOT NULL,
	`response` text,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_queue` ON `relay_messages` (`code`,`created`);--> statement-breakpoint
CREATE INDEX `messages_expiry` ON `relay_messages` (`expires`);--> statement-breakpoint
CREATE TABLE `relay_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`public_key` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_expiry` ON `relay_rooms` (`expires`);