-- Versi kebutuhan layanan custom terpisah dari updated_at: klaim/lepas Tim LA mengubah updated_at, sehingga dulu
-- terbaca sebagai "diubah CS", harga yang sedang diketik hilang, dan harga ditolak sebagai versi lama.
ALTER TABLE `custom_requests` ADD COLUMN `requirements_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
UPDATE `custom_requests` SET `requirements_updated_at` = `updated_at`;
