-- Create "publish_histories" table
CREATE TABLE `publish_histories` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `connection_id` integer NULL,
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
  `published_at` datetime NULL,
  CONSTRAINT `fk_connections_publish_histories` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "publish_history_connid" to table: "publish_histories"
CREATE INDEX `publish_history_connid` ON `publish_histories` (`connection_id`);
