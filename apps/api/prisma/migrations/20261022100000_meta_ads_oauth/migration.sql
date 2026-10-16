-- Token iklan hasil OAuth "Hubungkan Meta": sumber dan waktu kedaluwarsa untuk pembaruan otomatis.
ALTER TABLE `brands`
  ADD COLUMN `meta_ads_token_source` VARCHAR(10) NULL,
  ADD COLUMN `meta_ads_token_expires_at` DATETIME(3) NULL;
