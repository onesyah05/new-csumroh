-- Kontak terikat ke nomor device WhatsApp asalnya; hanya tampil saat device itu tersambung.
ALTER TABLE `prospects` ADD COLUMN `device_phone` VARCHAR(30) NULL;
CREATE INDEX `prospects_brand_id_device_phone_idx` ON `prospects`(`brand_id`, `device_phone`);
-- Data lama diikat ke nomor device brand saat ini (bila ada). Sisanya diikat saat device berikutnya tersambung.
UPDATE `prospects` p
  JOIN `whatsapp_sessions` s ON s.`brand_id` = p.`brand_id`
  SET p.`device_phone` = SUBSTRING_INDEX(SUBSTRING_INDEX(s.`phone_number`, '@', 1), ':', 1)
  WHERE s.`phone_number` IS NOT NULL AND s.`phone_number` <> '';
