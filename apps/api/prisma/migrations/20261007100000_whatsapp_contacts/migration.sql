-- Nama kontak WhatsApp per device, dipakai saat prospeknya dibuat setelah kontak tiba.
CREATE TABLE `whatsapp_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER NOT NULL,
    `device_phone` VARCHAR(30) NOT NULL,
    `phone` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `whatsapp_contacts_brand_id_device_phone_phone_key`(`brand_id`, `device_phone`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `whatsapp_contacts` ADD CONSTRAINT `whatsapp_contacts_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
