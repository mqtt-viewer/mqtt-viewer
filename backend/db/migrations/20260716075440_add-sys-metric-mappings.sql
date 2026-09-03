-- Create "sys_metric_mappings" table
CREATE TABLE `sys_metric_mappings` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  `connection_id` integer NULL,
  `metric_key` text NULL,
  `label` text NULL,
  `topic` text NULL,
  `payload_path` text NULL,
  `unit` text NULL,
  `sort_order` integer NULL,
  CONSTRAINT `fk_connections_sys_metric_mappings` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "sys_metric_mappings_connid" to table: "sys_metric_mappings"
CREATE INDEX `sys_metric_mappings_connid` ON `sys_metric_mappings` (`connection_id`);
