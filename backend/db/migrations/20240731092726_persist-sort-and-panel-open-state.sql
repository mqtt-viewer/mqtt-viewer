-- Add column "is_open" to table: "panel_sizes"
ALTER TABLE `panel_sizes` ADD COLUMN `is_open` numeric NULL;
-- Create "sort_states" table
CREATE TABLE `sort_states` (
  `id` text NULL,
  `sort_criteria` text NULL,
  `sort_direction` text NULL,
  PRIMARY KEY (`id`)
);
