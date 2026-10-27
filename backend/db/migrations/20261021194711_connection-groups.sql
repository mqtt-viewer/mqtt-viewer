-- Create "connection_groups" table
CREATE TABLE `connection_groups` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `name` text NOT NULL,
  `collapsed` numeric NOT NULL DEFAULT false,
  `created_at` datetime NULL,
  `updated_at` datetime NULL
);
-- Add column "group_id" to table: "connections"
ALTER TABLE `connections` ADD COLUMN `group_id` integer NULL;
-- Create index "connections_group_id" to table: "connections"
CREATE INDEX `connections_group_id` ON `connections` (`group_id`);
