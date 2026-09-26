-- Performa: ringkasan percakapan di tabel prospek (daftar Inbox/Pipeline & job SLA tanpa memuat pesan)
-- dan indeks jalur panas. Hanya menambah kolom/indeks; nilai diisi otomatis oleh API (backfill saat start).
-- AlterTable
ALTER TABLE `prospects` ADD COLUMN `awaiting_since` INTEGER UNSIGNED NULL,
    ADD COLUMN `conversation_stats_at` DATETIME(3) NULL,
    ADD COLUMN `inbound_sender_name` VARCHAR(100) NULL,
    ADD COLUMN `last_message` JSON NULL,
    ADD COLUMN `last_message_at` INTEGER UNSIGNED NULL,
    ADD COLUMN `message_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `unread_count` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `prospects_brand_id_remote_jid_idx` ON `prospects`(`brand_id`, `remote_jid`);

-- CreateIndex
CREATE INDEX `prospects_brand_id_phone_idx` ON `prospects`(`brand_id`, `phone`);

-- CreateIndex
CREATE INDEX `prospects_brand_id_last_message_at_idx` ON `prospects`(`brand_id`, `last_message_at`);

-- CreateIndex
CREATE INDEX `prospects_brand_id_conversation_stats_at_idx` ON `prospects`(`brand_id`, `conversation_stats_at`);

