-- Ad account Meta per brand: sumber biaya iklan (Insights API) untuk laporan CPL/CAC/ROAS.
ALTER TABLE `brands` ADD COLUMN `meta_ad_account_id` VARCHAR(50) NULL AFTER `meta_waba_id`;
