-- Waktu prospek pertama kali Terkualifikasi: dasar event_time QualifiedLead ke Meta (tidak bergeser saat retry/backfill).
ALTER TABLE `prospects` ADD COLUMN `qualified_at` DATETIME(3) NULL;
