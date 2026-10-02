-- Add column "proto_override" to table: "publish_histories"
ALTER TABLE `publish_histories` ADD COLUMN `proto_override` text NULL;
-- Add column "proto_reg_dir" to table: "connections"
ALTER TABLE `connections` ADD COLUMN `proto_reg_dir` text NULL;
-- Add column "proto_override" to table: "collection_messages"
ALTER TABLE `collection_messages` ADD COLUMN `proto_override` text NULL;
-- Create "proto_binding_rules" table
CREATE TABLE `proto_binding_rules` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  `connection_id` integer NULL,
  `topic_filter` text NULL,
  `message_type` text NULL,
  `sort_order` integer NULL,
  CONSTRAINT `fk_connections_proto_binding_rules` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "proto_binding_rules_connid" to table: "proto_binding_rules"
CREATE INDEX `proto_binding_rules_connid` ON `proto_binding_rules` (`connection_id`);
