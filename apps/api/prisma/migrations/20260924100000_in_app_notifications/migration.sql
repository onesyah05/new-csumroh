-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `brand_id` INTEGER NULL,
    `type` VARCHAR(50) NOT NULL,
    `priority` ENUM('info', 'action', 'urgent') NOT NULL DEFAULT 'info',
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(500) NULL,
    `link` VARCHAR(300) NULL,
    `entity_type` VARCHAR(30) NULL,
    `entity_id` INTEGER NULL,
    `actor_id` INTEGER NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `active_key` VARCHAR(150) NULL,
    `read_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notifications_user_id_read_at_created_at_idx`(`user_id`, `read_at`, `created_at`),
    INDEX `notifications_entity_type_entity_id_resolved_at_idx`(`entity_type`, `entity_id`, `resolved_at`),
    UNIQUE INDEX `notifications_user_id_active_key_key`(`user_id`, `active_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `user_id` INTEGER NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `toast` BOOLEAN NOT NULL DEFAULT true,
    `sound` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`user_id`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_dedupes` (
    `key` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_dedupes_created_at_idx`(`created_at`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

