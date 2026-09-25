-- Layanan Custom: peran Product dan permintaan custom.
-- AlterTable
ALTER TABLE `users` MODIFY `role` ENUM('superadmin', 'admin', 'cs', 'finance', 'product') NOT NULL DEFAULT 'cs';

-- CreateTable
CREATE TABLE `custom_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `prospect_id` INTEGER NOT NULL,
    `created_by_id` INTEGER NULL,
    `base_package_id` INTEGER NULL,
    `status` ENUM('submitted', 'quoted', 'revision_requested', 'agreed', 'cancelled') NOT NULL DEFAULT 'submitted',
    `mode` VARCHAR(10) NOT NULL DEFAULT 'full',
    `departure_date` DATE NULL,
    `departure_note` VARCHAR(100) NULL,
    `departure_city` VARCHAR(100) NULL,
    `airline` VARCHAR(100) NULL,
    `flight_type` VARCHAR(20) NULL,
    `pax_quad` INTEGER NOT NULL DEFAULT 0,
    `pax_triple` INTEGER NOT NULL DEFAULT 0,
    `pax_double` INTEGER NOT NULL DEFAULT 0,
    `pax_infant` INTEGER NOT NULL DEFAULT 0,
    `hotel_makkah` VARCHAR(150) NULL,
    `nights_makkah` INTEGER NULL,
    `hotel_madinah` VARCHAR(150) NULL,
    `nights_madinah` INTEGER NULL,
    `extend_nights_makkah` INTEGER NULL,
    `extend_nights_madinah` INTEGER NULL,
    `extra_hotels` JSON NULL,
    `route` VARCHAR(20) NULL,
    `equipment` BOOLEAN NULL,
    `fast_train` BOOLEAN NULL,
    `tour_leader` BOOLEAN NULL,
    `muthawif` BOOLEAN NULL,
    `city_tour` TEXT NULL,
    `budget_per_pax` DECIMAL(15, 2) NULL,
    `special_needs` TEXT NULL,
    `notes` TEXT NULL,
    `offered_price` DECIMAL(15, 2) NULL,
    `floor_price` DECIMAL(15, 2) NULL,
    `min_dp_per_pax` DECIMAL(15, 2) NULL,
    `quote_valid_until` DATETIME(3) NULL,
    `quote_note` TEXT NULL,
    `quoted_by_id` INTEGER NULL,
    `quoted_at` DATETIME(3) NULL,
    `revision_note` TEXT NULL,
    `agreed_price` DECIMAL(15, 2) NULL,
    `agreed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `custom_requests_status_created_at_idx`(`status`, `created_at`),
    INDEX `custom_requests_prospect_id_idx`(`prospect_id`),
    INDEX `custom_requests_brand_id_status_idx`(`brand_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `custom_requests` ADD CONSTRAINT `custom_requests_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `custom_requests` ADD CONSTRAINT `custom_requests_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `custom_requests` ADD CONSTRAINT `custom_requests_base_package_id_fkey` FOREIGN KEY (`base_package_id`) REFERENCES `packages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `custom_requests` ADD CONSTRAINT `custom_requests_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `custom_requests` ADD CONSTRAINT `custom_requests_quoted_by_id_fkey` FOREIGN KEY (`quoted_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
