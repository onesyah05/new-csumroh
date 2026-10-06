-- Waktu terakhir foto profil WhatsApp prospek dicek, disimpan agar API restart tidak memicu ratusan permintaan foto
-- profil sekaligus ke WhatsApp (diduga menyebabkan WhatsApp memutus koneksi device).
ALTER TABLE `prospects` ADD COLUMN `photo_checked_at` DATETIME(3) NULL;
