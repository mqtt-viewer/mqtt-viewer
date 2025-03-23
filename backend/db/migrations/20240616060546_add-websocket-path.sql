-- Add column "websocket_path" to table: "connections"
ALTER TABLE `connections` ADD COLUMN `websocket_path` text NULL;
