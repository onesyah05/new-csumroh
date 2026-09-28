-- Riwayat chat dipisah per nomor device WhatsApp brand.
ALTER TABLE `chat_messages` ADD COLUMN `device_phone` VARCHAR(30) NULL;
CREATE INDEX `chat_messages_brand_id_device_phone_idx` ON `chat_messages`(`brand_id`, `device_phone`);

-- Pesan lama mengikuti device prospeknya.
UPDATE `chat_messages` c
  JOIN `prospects` p ON p.`id` = c.`prospect_id`
  SET c.`device_phone` = p.`device_phone`
  WHERE c.`device_phone` IS NULL AND p.`device_phone` IS NOT NULL;

-- Perbaiki nama kontak yang terisi nama akun WhatsApp brand sendiri (pushName pesan keluar):
-- kembalikan ke nomor agar nama pengirim pesan masuk / kontak buku telepon dipakai lagi.
UPDATE `prospects` p
  SET p.`name` = CONCAT('+', p.`phone`)
  WHERE p.`phone` IS NOT NULL AND p.`phone` <> ''
    AND p.`name` IN (
      SELECT DISTINCT o.`sender_name` FROM `chat_messages` o
      WHERE o.`brand_id` = p.`brand_id` AND o.`is_from_me` = 1 AND o.`sender_name` IS NOT NULL
    )
    AND p.`name` NOT IN (
      SELECT DISTINCT i.`sender_name` FROM `chat_messages` i
      WHERE i.`prospect_id` = p.`id` AND i.`is_from_me` = 0 AND i.`sender_name` IS NOT NULL
    );
