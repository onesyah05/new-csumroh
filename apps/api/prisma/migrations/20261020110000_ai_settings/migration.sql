-- Pengaturan Asisten AI (satu baris) yang dikelola Superadmin dari dashboard; kunci API terenkripsi.
CREATE TABLE `ai_settings` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `api_key` TEXT NULL,
  `model` VARCHAR(80) NOT NULL DEFAULT 'claude-haiku-5-5',
  `pilot_user_ids` JSON NULL,
  `daily_limit_per_user` INTEGER NOT NULL DEFAULT 150,
  `updated_by_id` INTEGER NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
