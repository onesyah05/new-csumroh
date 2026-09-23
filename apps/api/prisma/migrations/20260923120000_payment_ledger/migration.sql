-- AlterTable
ALTER TABLE `prospects` ADD COLUMN `invoice_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `invoice_message_id` VARCHAR(100) NULL,
    ADD COLUMN `offer_message_id` VARCHAR(100) NULL,
    ADD COLUMN `payment_proof_message_id` VARCHAR(100) NULL,
    ADD COLUMN `payment_proof_submitted_at` DATETIME(3) NULL,
    ADD COLUMN `seats_reserved` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `prospect_id` INTEGER NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `bank_name` VARCHAR(50) NOT NULL,
    `reference_no` VARCHAR(100) NULL,
    `mutation_date` DATE NULL,
    `idempotency_key` VARCHAR(120) NOT NULL,
    `status` ENUM('verified', 'reversed') NOT NULL DEFAULT 'verified',
    `notes` TEXT NULL,
    `proof_url` TEXT NULL,
    `proof_message_id` VARCHAR(100) NULL,
    `verified_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_idempotency_key_key`(`idempotency_key`),
    INDEX `payments_prospect_id_created_at_idx`(`prospect_id`, `created_at`),
    UNIQUE INDEX `payments_brand_id_reference_no_key`(`brand_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (mempertahankan data lama)
-- 1. Nominal tagihan invoice dahulu disimpan di dp_amount. Salin sebagai invoice_amount.
UPDATE `prospects` SET `invoice_amount` = `dp_amount` WHERE `invoice_number` IS NOT NULL AND `dp_amount` > 0;

-- 2. dp_amount kini berarti kas terverifikasi. Prospek yang belum pernah diverifikasi Finance
--    dan belum Deal tidak boleh membawa angka tagihan sebagai kas.
UPDATE `prospects` SET `dp_amount` = 0
WHERE `verified_by_user_id` IS NULL
  AND `payment_status` = 'unpaid'
  AND `status` NOT IN ('deal', 'closed_won');

-- 3. Saldo kas lama (beserta bukti yang dipakai, agar bukti itu tidak muncul lagi di antrean verifikasi) yang tersisa dicatat sebagai satu baris ledger agar SUM(payments) = dp_amount.
INSERT INTO `payments` (`brand_id`, `prospect_id`, `amount`, `bank_name`, `idempotency_key`, `status`, `proof_url`, `notes`, `verified_by_user_id`, `created_at`)
SELECT `brand_id`, `id`, `dp_amount`, 'LEGACY', CONCAT('legacy-backfill:', `id`), 'verified', `payment_proof_url`,
       'Saldo kas sebelum ledger pembayaran (backfill migrasi 20260923)', `verified_by_user_id`, COALESCE(`dp_paid_at`, `updated_at`)
FROM `prospects` WHERE `dp_amount` > 0;

-- 4. Estimasi seat yang sudah terpotong untuk booking Deal berpaket (infant tidak memakai seat).
UPDATE `prospects`
SET `seats_reserved` = GREATEST(1, `pax_quad` + `pax_triple` + `pax_double`)
WHERE `status` IN ('deal', 'closed_won') AND `package_id` IS NOT NULL;

-- 5. Bukti yang sudah ada dianggap diajukan pada update terakhir prospek.
UPDATE `prospects` SET `payment_proof_submitted_at` = `updated_at` WHERE `payment_proof_url` IS NOT NULL;
