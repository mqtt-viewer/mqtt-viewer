-- Dockable selected-topic panel: global dock mode and the side to return to
-- when a pop-out window closes.
ALTER TABLE `app_settings` ADD COLUMN `topic_panel_dock_mode` text NOT NULL DEFAULT 'right';
ALTER TABLE `app_settings` ADD COLUMN `topic_panel_last_docked_side` text NOT NULL DEFAULT 'right';
