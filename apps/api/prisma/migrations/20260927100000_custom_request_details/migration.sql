-- Layanan Custom: rentang tanggal, layanan dikurangi/ditambah, harga per jamaah per tipe kamar.
-- AlterTable
ALTER TABLE `custom_requests` ADD COLUMN `departure_date_to` DATE NULL,
    ADD COLUMN `floor_prices` JSON NULL,
    ADD COLUMN `offered_prices` JSON NULL,
    ADD COLUMN `services_added` JSON NULL,
    ADD COLUMN `services_removed` JSON NULL;
