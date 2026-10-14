-- Bulan rencana tambahan prospek ("YYYY-MM,YYYY-MM", maksimal 3). Bulan utama tetap di target_month.
ALTER TABLE `prospects` ADD COLUMN `target_months_extra` VARCHAR(40) NULL;
