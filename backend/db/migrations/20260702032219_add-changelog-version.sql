-- Track which version's "What's new" changelog the user has dismissed.
ALTER TABLE `app_settings` ADD COLUMN `last_seen_changelog_version` text NOT NULL DEFAULT '';
