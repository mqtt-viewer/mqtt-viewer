-- Add column "position" to table: "collections"
ALTER TABLE `collections` ADD COLUMN `position` integer NULL;
-- Add column "position" to table: "collection_messages"
ALTER TABLE `collection_messages` ADD COLUMN `position` integer NULL;
-- Backfill positions in id order within each collection
UPDATE `collection_messages` SET `position` = (
  SELECT COUNT(*) FROM `collection_messages` AS `m2`
  WHERE `m2`.`collection_id` = `collection_messages`.`collection_id`
    AND `m2`.`id` < `collection_messages`.`id`
);
-- Backfill positions in id order within each scope (global, or per connection)
UPDATE `collections` SET `position` = (
  SELECT COUNT(*) FROM `collections` AS `c2`
  WHERE (
      (`c2`.`connection_id` IS NULL AND `collections`.`connection_id` IS NULL)
      OR `c2`.`connection_id` = `collections`.`connection_id`
    )
    AND `c2`.`id` < `collections`.`id`
);
