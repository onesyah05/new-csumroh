-- AlterTable
ALTER TABLE `brands` ADD COLUMN `gmaps_url` TEXT NULL;

-- AlterTable
ALTER TABLE `users` MODIFY `role` ENUM('superadmin', 'admin', 'cs', 'finance') NOT NULL DEFAULT 'cs';

-- AlterTable
ALTER TABLE `prospects` ADD COLUMN `invoice_due_at` DATETIME(3) NULL,
    ADD COLUMN `invoice_number` VARCHAR(100) NULL,
    ADD COLUMN `invoice_sent_at` DATETIME(3) NULL,
    ADD COLUMN `objection_category` VARCHAR(50) NULL,
    ADD COLUMN `objection_notes` TEXT NULL,
    ADD COLUMN `offer_sent_at` DATETIME(3) NULL,
    ADD COLUMN `payment_proof_url` TEXT NULL,
    ADD COLUMN `verified_by_user_id` INTEGER NULL,
    MODIFY `status` ENUM('new', 'contact', 'qualified', 'offer', 'objection', 'followup', 'closing', 'deal', 'lose', 'identifying', 'offered', 'closed_won', 'closed_lost', 'nurture') NOT NULL DEFAULT 'new';

-- AlterTable
ALTER TABLE `chat_messages` ADD COLUMN `is_starred` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reaction_user_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `user_brands` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `brand_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_brands_brand_id_idx`(`brand_id`),
    UNIQUE INDEX `user_brands_user_id_brand_id_key`(`user_id`, `brand_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_brands` ADD CONSTRAINT `user_brands_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_brands` ADD CONSTRAINT `user_brands_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

