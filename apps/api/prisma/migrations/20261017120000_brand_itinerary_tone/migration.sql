-- Warna teks gambar itinerary mengikuti banner template: light (teks gelap) atau dark (teks terang).
ALTER TABLE `brands` ADD COLUMN `itinerary_tone` VARCHAR(10) NOT NULL DEFAULT 'light';
