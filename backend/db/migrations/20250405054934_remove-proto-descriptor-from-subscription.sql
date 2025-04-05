-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_subscriptions" table
CREATE TABLE `new_subscriptions` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  `connection_id` integer NULL,
  `qo_s` integer NULL,
  `topic` text NULL,
  CONSTRAINT `fk_connections_subscriptions` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Copy rows from old table "subscriptions" to new temporary table "new_subscriptions"
INSERT INTO `new_subscriptions` (`id`, `created_at`, `updated_at`, `connection_id`, `qo_s`, `topic`) SELECT `id`, `created_at`, `updated_at`, `connection_id`, `qo_s`, `topic` FROM `subscriptions`;
-- Drop "subscriptions" table after copying rows
DROP TABLE `subscriptions`;
-- Rename temporary table "new_subscriptions" to "subscriptions"
ALTER TABLE `new_subscriptions` RENAME TO `subscriptions`;
-- Create "new_connections" table
CREATE TABLE `new_connections` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  `name` text NULL,
  `mqtt_version` text NULL,
  `has_custom_client_id` numeric NULL,
  `client_id` text NULL,
  `protocol` text NULL,
  `host` text NULL,
  `port` integer NULL,
  `websocket_path` text NULL,
  `username` text NULL,
  `password` text NULL,
  `is_proto_enabled` numeric NULL,
  `is_certs_enabled` numeric NULL,
  `skip_cert_verification` numeric NULL,
  `cert_ca` text NULL,
  `cert_client` text NULL,
  `cert_client_key` text NULL,
  `last_connected_at` datetime NULL,
  `custom_icon_seed` text NULL
);
-- Copy rows from old table "connections" to new temporary table "new_connections"
INSERT INTO `new_connections` (`id`, `created_at`, `updated_at`, `name`, `mqtt_version`, `has_custom_client_id`, `client_id`, `protocol`, `host`, `port`, `websocket_path`, `username`, `password`, `is_proto_enabled`, `is_certs_enabled`, `skip_cert_verification`, `cert_ca`, `cert_client`, `cert_client_key`, `last_connected_at`, `custom_icon_seed`) SELECT `id`, `created_at`, `updated_at`, `name`, `mqtt_version`, `has_custom_client_id`, `client_id`, `protocol`, `host`, `port`, `websocket_path`, `username`, `password`, `is_proto_enabled`, `is_certs_enabled`, `skip_cert_verification`, `cert_ca`, `cert_client`, `cert_client_key`, `last_connected_at`, `custom_icon_seed` FROM `connections`;
-- Drop "connections" table after copying rows
DROP TABLE `connections`;
-- Rename temporary table "new_connections" to "connections"
ALTER TABLE `new_connections` RENAME TO `connections`;
-- Create "new_globals" table
CREATE TABLE `new_globals` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `local_passwords_encrypted` numeric NULL
);
-- Copy rows from old table "globals" to new temporary table "new_globals"
INSERT INTO `new_globals` (`id`, `local_passwords_encrypted`) SELECT `id`, `local_passwords_encrypted` FROM `globals`;
-- Drop "globals" table after copying rows
DROP TABLE `globals`;
-- Rename temporary table "new_globals" to "globals"
ALTER TABLE `new_globals` RENAME TO `globals`;
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
