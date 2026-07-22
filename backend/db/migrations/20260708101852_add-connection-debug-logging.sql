-- Per-connection opt-in verbose MQTT-library debug logging for the client-logs
-- viewer (issue #4). nil/false means only always-on lifecycle/error lines are
-- captured; true enables the library debug firehose for that connection.
ALTER TABLE `connections` ADD COLUMN `debug_logging_enabled` numeric NOT NULL DEFAULT false;
