-- Track which update version the user chose to skip from the update dialog.
ALTER TABLE `app_settings` ADD COLUMN `ignored_update_version` text NOT NULL DEFAULT '';
