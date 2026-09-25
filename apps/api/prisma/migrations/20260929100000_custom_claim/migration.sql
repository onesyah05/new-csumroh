-- Layanan Custom: anggota Tim LA yang sedang menghitung.
-- AlterTable
ALTER TABLE `custom_requests` ADD COLUMN `claimed_at` DATETIME(3) NULL,
    ADD COLUMN `claimed_by_id` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `custom_requests` ADD CONSTRAINT `custom_requests_claimed_by_id_fkey` FOREIGN KEY (`claimed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
