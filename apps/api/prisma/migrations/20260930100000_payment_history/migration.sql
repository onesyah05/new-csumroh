-- Verifikasi pembayaran: riwayat penolakan terstruktur + koreksi/pembatalan pembayaran.
-- AlterTable
ALTER TABLE `payments` ADD COLUMN `corrected_at` DATETIME(3) NULL,
    ADD COLUMN `reversal_reason` TEXT NULL,
    ADD COLUMN `reversed_at` DATETIME(3) NULL,
    ADD COLUMN `reversed_by_user_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `payment_proof_rejections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `prospect_id` INTEGER NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'rejected',
    `proof_url` TEXT NULL,
    `proof_message_id` VARCHAR(100) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `rejected_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_proof_rejections_brand_id_created_at_idx`(`brand_id`, `created_at`),
    INDEX `payment_proof_rejections_prospect_id_created_at_idx`(`prospect_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_proof_rejections` ADD CONSTRAINT `payment_proof_rejections_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_proof_rejections` ADD CONSTRAINT `payment_proof_rejections_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_proof_rejections` ADD CONSTRAINT `payment_proof_rejections_rejected_by_id_fkey` FOREIGN KEY (`rejected_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: penolakan lama tersimpan sebagai log "Alasan: … · Berkas: … · Oleh: …".
INSERT INTO `payment_proof_rejections` (`brand_id`, `prospect_id`, `kind`, `proof_url`, `reason`, `rejected_by_id`, `created_at`)
SELECT p.`brand_id`, l.`prospect_id`, 'rejected',
       SUBSTRING_INDEX(SUBSTRING_INDEX(l.`description`, ' · Berkas: ', -1), ' · Oleh: ', 1),
       LEFT(SUBSTRING(SUBSTRING_INDEX(l.`description`, ' · Berkas: ', 1), 9), 500),
       u.`id`, l.`created_at`
FROM `prospect_logs` l
JOIN `prospects` p ON p.`id` = l.`prospect_id`
LEFT JOIN `users` u ON u.`id` = l.`user_id`
WHERE l.`action_type` = 'payment_proof_rejected' AND l.`description` LIKE 'Alasan: %';
