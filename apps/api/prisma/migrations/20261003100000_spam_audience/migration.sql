-- Penanda chat spam per prospek + audiens pengecualian spam per brand di Meta.
ALTER TABLE `prospects` ADD COLUMN `spam_at` DATETIME(3) NULL, ADD COLUMN `spam_by_user_id` INTEGER NULL;
CREATE INDEX `prospects_brand_id_spam_at_idx` ON `prospects`(`brand_id`, `spam_at`);
ALTER TABLE `brands` ADD COLUMN `meta_spam_audience_id` VARCHAR(50) NULL, ADD COLUMN `meta_spam_synced_at` DATETIME(3) NULL;
