-- CreateTable
CREATE TABLE `brands` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `ppiu_number` VARCHAR(100) NULL,
    `bank_name` VARCHAR(50) NULL,
    `bank_account_number` VARCHAR(50) NULL,
    `bank_account_holder` VARCHAR(100) NULL,
    `address` TEXT NULL,
    `phone` VARCHAR(30) NULL,
    `meta_pixel_id` VARCHAR(50) NULL,
    `meta_access_token` TEXT NULL,
    `facebook_page_id` VARCHAR(50) NULL,
    `meta_waba_id` VARCHAR(50) NULL,
    `meta_test_event_code` VARCHAR(100) NULL,
    `meta_verified_at` DATETIME(3) NULL,
    `meta_last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `brands_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(100) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `role` ENUM('superadmin', 'admin', 'cs') NOT NULL DEFAULT 'cs',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_brand_id_is_active_idx`(`brand_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `packages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `price` VARCHAR(50) NOT NULL,
    `dp` VARCHAR(50) NOT NULL,
    `price_quad` VARCHAR(50) NULL,
    `price_triple` VARCHAR(50) NULL,
    `price_double` VARCHAR(50) NULL,
    `price_infant` VARCHAR(50) NULL,
    `quota_remaining` INTEGER NULL,
    `departure_date` DATE NULL,
    `airline` VARCHAR(100) NULL,
    `hotel_makkah` VARCHAR(100) NULL,
    `hotel_madinah` VARCHAR(100) NULL,
    `departure_info` VARCHAR(100) NULL,
    `duration` VARCHAR(50) NULL,
    `flight_type` VARCHAR(50) NULL,
    `facilities_included` TEXT NULL,
    `facilities_excluded` TEXT NULL,
    `itinerary` TEXT NULL,
    `highlights` TEXT NULL,
    `flyer_image` VARCHAR(255) NULL,
    `is_promo` BOOLEAN NOT NULL DEFAULT false,
    `promo_discount` VARCHAR(50) NULL,
    `promo_deadline` DATE NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `packages_brand_id_is_active_idx`(`brand_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `package_id` INTEGER NULL,
    `name` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `city` VARCHAR(100) NULL,
    `lead_source` VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
    `current_stage` VARCHAR(50) NOT NULL DEFAULT 'greeting',
    `status` ENUM('new', 'identifying', 'offered', 'objection', 'followup', 'closing', 'nurture', 'closed_won', 'closed_lost') NOT NULL DEFAULT 'new',
    `target_month` VARCHAR(50) NULL,
    `budget_range` VARCHAR(50) NULL,
    `room_preference` VARCHAR(50) NULL,
    `pax_quad` INTEGER NOT NULL DEFAULT 0,
    `pax_triple` INTEGER NOT NULL DEFAULT 0,
    `pax_double` INTEGER NOT NULL DEFAULT 0,
    `pax_infant` INTEGER NOT NULL DEFAULT 0,
    `special_needs` TEXT NULL,
    `decision_maker` VARCHAR(50) NULL,
    `passport_status` VARCHAR(50) NULL,
    `vaccine_status` VARCHAR(50) NULL,
    `deal_value` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `dp_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `dp_paid_at` DATETIME(3) NULL,
    `payment_status` ENUM('unpaid', 'partial_dp', 'paid_full') NOT NULL DEFAULT 'unpaid',
    `lost_reason` VARCHAR(100) NULL,
    `lost_reason_detail` TEXT NULL,
    `remote_jid` VARCHAR(100) NULL,
    `meta_referral_marker` TEXT NULL,
    `ad_id` VARCHAR(100) NULL,
    `campaign_id` VARCHAR(100) NULL,
    `ad_headline` VARCHAR(255) NULL,
    `ad_source_url` TEXT NULL,
    `closed_won_count` INTEGER NOT NULL DEFAULT 0,
    `photo_url` TEXT NULL,
    `notes` TEXT NULL,
    `next_followup_date` DATE NULL,
    `last_followup_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `prospects_brand_id_status_idx`(`brand_id`, `status`),
    INDEX `prospects_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospect_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prospect_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `action_type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `prospect_logs_prospect_id_created_at_idx`(`prospect_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `phone_number` VARCHAR(30) NULL,
    `session_name` VARCHAR(100) NOT NULL,
    `status` ENUM('disconnected', 'connecting', 'connected', 'qr_ready') NOT NULL DEFAULT 'disconnected',
    `qr_code` TEXT NULL,
    `last_connected_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `whatsapp_sessions_brand_id_key`(`brand_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `prospect_id` INTEGER NULL,
    `message_id` VARCHAR(100) NOT NULL,
    `remote_jid` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(30) NOT NULL,
    `sender_name` VARCHAR(100) NULL,
    `is_from_me` BOOLEAN NOT NULL DEFAULT false,
    `message_type` VARCHAR(30) NOT NULL DEFAULT 'conversation',
    `message_text` TEXT NULL,
    `media_url` TEXT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'delivered',
    `timestamp` INTEGER UNSIGNED NOT NULL,
    `meta_referral_data` JSON NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `deleted_at` DATETIME(3) NULL,
    `reaction` VARCHAR(10) NULL,
    `quoted_message_id` VARCHAR(100) NULL,
    `quoted_text` TEXT NULL,
    `quoted_sender` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_messages_brand_id_remote_jid_idx`(`brand_id`, `remote_jid`),
    INDEX `chat_messages_prospect_id_timestamp_idx`(`prospect_id`, `timestamp`),
    UNIQUE INDEX `chat_messages_brand_id_message_id_key`(`brand_id`, `message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meta_capi_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `prospect_id` INTEGER NOT NULL,
    `event_name` VARCHAR(50) NOT NULL,
    `event_id` VARCHAR(100) NOT NULL,
    `payload` TEXT NULL,
    `response_status` INTEGER NULL,
    `response_body` TEXT NULL,
    `status` ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'success',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `meta_capi_logs_brand_id_created_at_idx`(`brand_id`, `created_at`),
    UNIQUE INDEX `meta_capi_logs_brand_id_event_id_key`(`brand_id`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `packages` ADD CONSTRAINT `packages_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_package_id_fkey` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospect_logs` ADD CONSTRAINT `prospect_logs_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospect_logs` ADD CONSTRAINT `prospect_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsapp_sessions` ADD CONSTRAINT `whatsapp_sessions_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meta_capi_logs` ADD CONSTRAINT `meta_capi_logs_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meta_capi_logs` ADD CONSTRAINT `meta_capi_logs_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
