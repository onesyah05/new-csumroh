-- Log Saran Balasan AI di Copilot Inbox: template opsi, hasil deteksi, token, latensi, dan tindakan CS.
CREATE TABLE `ai_suggestions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `brand_id` INTEGER NOT NULL,
  `prospect_id` INTEGER NULL,
  `user_id` INTEGER NOT NULL,
  `previous_id` INTEGER NULL,
  `source` VARCHAR(10) NOT NULL,
  `fallback_reason` VARCHAR(30) NULL,
  `model` VARCHAR(80) NULL,
  `intent` VARCHAR(30) NULL,
  `objection` VARCHAR(30) NULL,
  `coverage` VARCHAR(10) NULL,
  `options` JSON NOT NULL,
  `instruction` VARCHAR(200) NULL,
  `input_tokens` INTEGER NULL,
  `output_tokens` INTEGER NULL,
  `latency_ms` INTEGER NOT NULL,
  `action` VARCHAR(15) NULL,
  `option_index` TINYINT NULL,
  `similarity` DOUBLE NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `acted_at` DATETIME(3) NULL,
  INDEX `ai_suggestions_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `ai_suggestions_brand_id_created_at_idx`(`brand_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_suggestions` ADD CONSTRAINT `ai_suggestions_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `ai_suggestions_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `ai_suggestions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
