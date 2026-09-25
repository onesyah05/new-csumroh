-- Layanan Custom: dikembalikan ke CS, waktu masuk antrean, versi harga, DP bayi.
-- AlterTable
ALTER TABLE `custom_requests` ADD COLUMN `min_dp_infant` DECIMAL(15, 2) NULL,
    ADD COLUMN `queued_at` DATETIME(3) NULL,
    ADD COLUMN `quote_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `return_note` TEXT NULL,
    MODIFY `status` ENUM('submitted', 'needs_info', 'quoted', 'revision_requested', 'agreed', 'cancelled') NOT NULL DEFAULT 'submitted';

-- Backfill: permintaan yang ada masuk antrean saat terakhir diubah; yang sudah dihitung minimal sekali.
UPDATE `custom_requests` SET `queued_at` = `updated_at` WHERE `queued_at` IS NULL;
UPDATE `custom_requests` SET `quote_count` = 1 WHERE `quoted_at` IS NOT NULL AND `quote_count` = 0;
