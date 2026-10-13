-- Balas cepat: template pesan yang dipilih CS dengan mengetik "/" di kolom pesan (per brand atau pribadi).
CREATE TABLE `quick_replies` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `brand_id` INTEGER NOT NULL,
  `scope` VARCHAR(10) NOT NULL DEFAULT 'brand',
  `owner_id` INTEGER NULL,
  `title` VARCHAR(80) NOT NULL,
  `shortcut` VARCHAR(30) NULL,
  `body` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `quick_replies_brand_id_scope_idx`(`brand_id`, `scope`),
  INDEX `quick_replies_owner_id_idx`(`owner_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `quick_replies` ADD CONSTRAINT `quick_replies_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `quick_replies` ADD CONSTRAINT `quick_replies_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
