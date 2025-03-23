-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
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
  `proto_reg_dir` text NULL,
  `is_certs_enabled` numeric NULL,
  `cert_ca` text NULL,
  `cert_client` text NULL,
  `cert_client_key` text NULL,
  `last_connected_at` datetime NULL,
  `custom_icon_seed` text NULL
);
-- Copy rows from old table "connections" to new temporary table "new_connections"
INSERT INTO `new_connections` (`id`, `created_at`, `updated_at`, `name`, `mqtt_version`, `has_custom_client_id`, `client_id`, `protocol`, `host`, `port`, `websocket_path`, `username`, `password`, `is_proto_enabled`, `proto_reg_dir`, `is_certs_enabled`, `cert_ca`, `cert_client`, `cert_client_key`, `last_connected_at`, `custom_icon_seed`) SELECT `id`, `created_at`, `updated_at`, `name`, `mqtt_version`, `has_custom_client_id`, `client_id`, `protocol`, `host`, `port`, `websocket_path`, `username`, `password`, `is_proto_enabled`, `proto_reg_dir`, `is_certs_enabled`, `cert_ca`, `cert_client`, `cert_client_key`, `last_connected_at`, `custom_icon_seed` FROM `connections`;
-- Drop "connections" table after copying rows
DROP TABLE `connections`;
-- Rename temporary table "new_connections" to "connections"
ALTER TABLE `new_connections` RENAME TO `connections`;
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
