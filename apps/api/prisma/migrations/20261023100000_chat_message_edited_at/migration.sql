-- Penanda "Diedit" pada pesan chat.
ALTER TABLE `chat_messages` ADD COLUMN `edited_at` DATETIME(3) NULL;
