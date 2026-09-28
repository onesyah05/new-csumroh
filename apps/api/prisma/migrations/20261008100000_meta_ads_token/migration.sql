-- Token baca iklan (ads_read) terpisah dari token CAPI Events Manager.
ALTER TABLE `brands` ADD COLUMN `meta_ads_access_token` TEXT NULL;
