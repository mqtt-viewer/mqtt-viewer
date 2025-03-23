-- Create "globals" table
CREATE TABLE `globals` (
  `id` integer NULL PRIMARY KEY AUTOINCREMENT,
  `local_passwords_encrypted` numeric DEFAULT 1
);
