-- AlterTable
ALTER TABLE `meta_capi_logs` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- Existing rows: last attempt time is unknown, the creation time is the best approximation.
UPDATE `meta_capi_logs` SET `updated_at` = `created_at`;

-- CreateIndex
CREATE INDEX `meta_capi_logs_status_created_at_idx` ON `meta_capi_logs`(`status`, `created_at`);
