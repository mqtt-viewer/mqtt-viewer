-- Create "pinned_topics" table
CREATE TABLE `pinned_topics` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `connection_id` integer NULL,
  `topic` text NULL,
  `position` integer NULL
);
-- Create index "pinned_topics_conn_topic" to table: "pinned_topics"
CREATE UNIQUE INDEX `pinned_topics_conn_topic` ON `pinned_topics` (`connection_id`, `topic`);
-- Create index "pinned_topics_connid" to table: "pinned_topics"
CREATE INDEX `pinned_topics_connid` ON `pinned_topics` (`connection_id`);
