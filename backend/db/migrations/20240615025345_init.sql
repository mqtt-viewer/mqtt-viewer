-- Create "connections" table
CREATE TABLE `connections` (
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
  `username` text NULL,
  `password` text NULL,
  `is_proto_enabled` numeric NULL,
  `proto_reg_dir` text NULL,
  `is_certs_enabled` numeric NULL,
  `cert_ca` text NULL,
  `cert_client` text NULL,
  `cert_client_key` text NULL,
  `last_connected_at` datetime NULL,
  `custom_icon_seed` text NULL,
  `reset_data_on_connect` numeric NULL
);
-- Create "tabs" table
CREATE TABLE `tabs` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `tab_index` integer NULL,
  `connection_id` integer NULL,
  CONSTRAINT `fk_tabs_connection` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "subscriptions" table
CREATE TABLE `subscriptions` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  `connection_id` integer NULL,
  `qo_s` integer NULL,
  `topic` text NULL,
  `proto_descriptor` text NULL,
  CONSTRAINT `fk_connections_subscriptions` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "panel_sizes" table
CREATE TABLE `panel_sizes` (
  `id` text NULL,
  `size` integer NULL,
  PRIMARY KEY (`id`)
);
