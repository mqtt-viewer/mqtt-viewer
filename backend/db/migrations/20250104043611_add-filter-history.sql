-- Create "filter_histories" table
CREATE TABLE `filter_histories` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `connection_id` integer NULL,
  `text` text NULL,
  `last_used` datetime NULL,
  CONSTRAINT `fk_connections_filter_histories` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "conn_filter" to table: "filter_histories"
CREATE INDEX `conn_filter` ON `filter_histories` (`connection_id`, `text`);
-- Create index "conn" to table: "filter_histories"
CREATE INDEX `conn` ON `filter_histories` (`connection_id`);
