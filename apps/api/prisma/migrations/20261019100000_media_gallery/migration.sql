-- Galeri media bersama per brand (folder + berkas) dengan catatan pengunggah dan waktu.
CREATE TABLE `media_folders` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `brand_id` INTEGER NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `created_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `media_folders_brand_id_name_key`(`brand_id`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `media_assets` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `brand_id` INTEGER NOT NULL,
  `folder_id` INTEGER NULL,
  `name` VARCHAR(160) NOT NULL,
  `url` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(60) NOT NULL,
  `size` INTEGER NOT NULL,
  `width` INTEGER NULL,
  `height` INTEGER NULL,
  `uploaded_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `media_assets_brand_id_created_at_idx`(`brand_id`, `created_at`),
  INDEX `media_assets_brand_id_folder_id_idx`(`brand_id`, `folder_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `media_folders` ADD CONSTRAINT `media_folders_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `media_folders` ADD CONSTRAINT `media_folders_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `media_folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
