-- Akses berkas /uploads kini diperiksa per brand: pemilik media chat dicari dari pesan yang memuat URL-nya.
CREATE INDEX `chat_messages_media_url_idx` ON `chat_messages`(`media_url`(191));
