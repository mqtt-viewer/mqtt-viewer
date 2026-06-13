-- Create "app_settings" table (single row holding retention preferences)
CREATE TABLE `app_settings` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `memory_budget_bytes` integer NULL,
  `recording_enabled` numeric NULL,
  `disk_budget_bytes` integer NULL,
  `has_seen_history_prompt` numeric NULL
);
-- Seed defaults: 512 MB in-RAM budget, recording off, 1 GB disk budget.
INSERT OR IGNORE INTO `app_settings` (`id`, `memory_budget_bytes`, `recording_enabled`, `disk_budget_bytes`, `has_seen_history_prompt`)
VALUES (1, 536870912, 0, 1073741824, 0);
-- Create "received_messages" table (durable, opt-in message history)
CREATE TABLE `received_messages` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `connection_id` integer NULL,
  `topic` text NULL,
  `qo_s` integer NULL,
  `retain` numeric NULL,
  `payload` blob NULL,
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
  `received_at` datetime NULL,
  CONSTRAINT `fk_connections_received_messages` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Per-topic paged lookup: WHERE connection_id=? AND topic=? ORDER BY id DESC/ASC,
-- with keyset pagination on id. Its leftmost prefix (connection_id) also serves
-- the per-connection cascade deletes. Prune deletes oldest globally by id, which
-- uses the integer primary key (rowid) directly, so no extra index is needed.
CREATE INDEX `received_messages_conn_topic_id` ON `received_messages` (`connection_id`, `topic`, `id`);
