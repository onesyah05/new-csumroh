-- Prospek yang diikat ke device setelah migrasi chat_device_scope (device tersambung belakangan) masih punya pesan
-- tanpa device_phone, sehingga riwayatnya tidak tampil. Pesan mengikuti device prospeknya.
UPDATE `chat_messages` c
  JOIN `prospects` p ON p.`id` = c.`prospect_id`
  SET c.`device_phone` = p.`device_phone`
  WHERE c.`device_phone` IS NULL AND p.`device_phone` IS NOT NULL;
