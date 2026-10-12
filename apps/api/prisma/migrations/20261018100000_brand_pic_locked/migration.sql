-- Kunci PIC per brand: bila aktif, hanya Admin yang dapat mengganti PIC (tanpa ambil alih / serahkan oleh CS).
ALTER TABLE `brands` ADD COLUMN `pic_locked` BOOLEAN NOT NULL DEFAULT false;
