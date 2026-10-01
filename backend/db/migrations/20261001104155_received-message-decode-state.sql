-- Add column "decode_state" to table: "received_messages"
ALTER TABLE `received_messages` ADD COLUMN `decode_state` text NULL;
