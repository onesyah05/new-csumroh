-- Round robin CS: pembagian otomatis prospek baru sesuai persen per CS.
ALTER TABLE `brands` ADD COLUMN `round_robin_enabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `round_robin_shares` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `percent` INTEGER NOT NULL DEFAULT 0,
    `assigned_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `round_robin_shares_user_id_idx`(`user_id`),
    UNIQUE INDEX `round_robin_shares_brand_id_user_id_key`(`brand_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `round_robin_shares` ADD CONSTRAINT `round_robin_shares_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `round_robin_shares` ADD CONSTRAINT `round_robin_shares_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
