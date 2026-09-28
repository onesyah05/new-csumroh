-- CreateTable
CREATE TABLE `meta_ads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `ad_id` VARCHAR(50) NOT NULL,
    `ad_name` VARCHAR(255) NOT NULL,
    `campaign_name` VARCHAR(255) NULL,
    `thumbnail_url` VARCHAR(255) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `meta_ads_brand_id_ad_id_key`(`brand_id`, `ad_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- AddForeignKey
ALTER TABLE `meta_ads` ADD CONSTRAINT `meta_ads_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
