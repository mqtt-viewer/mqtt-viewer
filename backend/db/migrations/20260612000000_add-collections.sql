-- Create "collections" table
CREATE TABLE `collections` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `connection_id` integer NULL,
  `name` text NULL,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  CONSTRAINT `fk_connections_collections` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "collections_connid" to table: "collections"
CREATE INDEX `collections_connid` ON `collections` (`connection_id`);
-- Create "collection_messages" table
CREATE TABLE `collection_messages` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `collection_id` integer NULL,
  `name` text NULL,
  `topic` text NULL,
  `qo_s` integer NULL,
  `retain` numeric NULL,
  `payload` text NULL,
  `encoding` text NULL,
  `format` text NULL,
  `user_properties` text NULL,
  `header_content_type` text NULL,
  `header_response_topic` text NULL,
  `header_correlation_data` text NULL,
  `header_payload_format_indicator` numeric NULL,
  `header_message_expiry_interval` integer NULL,
  `header_topic_alias` integer NULL,
  `header_subscription_identifier` integer NULL,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  CONSTRAINT `fk_collections_messages` FOREIGN KEY (`collection_id`) REFERENCES `collections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "collection_messages_collid" to table: "collection_messages"
CREATE INDEX `collection_messages_collid` ON `collection_messages` (`collection_id`);
