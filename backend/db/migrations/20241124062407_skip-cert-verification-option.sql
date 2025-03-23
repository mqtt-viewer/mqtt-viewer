-- Add column "skip_cert_verification" to table: "connections"
ALTER TABLE `connections` ADD COLUMN `skip_cert_verification` numeric NULL;
