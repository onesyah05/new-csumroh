-- Laporan Lead Harian: akun CRM pengirim pesan keluar, dan indeks pesan keluar per brand dan waktu.
ALTER TABLE `chat_messages` ADD COLUMN `sender_user_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `chat_messages_brand_id_is_from_me_timestamp_idx` ON `chat_messages`(`brand_id`, `is_from_me`, `timestamp`);
