-- Count app launches and record whether the "star us on GitHub" prompt has been
-- shown, so it only appears once and never on a first-run install.
ALTER TABLE `app_settings` ADD COLUMN `launch_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `app_settings` ADD COLUMN `has_seen_star_prompt` numeric NOT NULL DEFAULT false;
