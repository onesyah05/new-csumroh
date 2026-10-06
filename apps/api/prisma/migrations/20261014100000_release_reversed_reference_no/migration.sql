-- Pembayaran yang dibatalkan masih memegang nomor referensi mutasi (unik per brand), sehingga transfer yang sama
-- tidak bisa diverifikasi ulang. Nomor dilepas dengan penanda batal, sama seperti pembatalan baru di aplikasi.
UPDATE `payments`
  SET `reference_no` = CONCAT(LEFT(`reference_no`, 100 - CHAR_LENGTH(CONCAT(' [batal #', `id`, ']'))), ' [batal #', `id`, ']')
  WHERE `status` = 'reversed' AND `reference_no` IS NOT NULL AND `reference_no` NOT LIKE '% [batal #%]';
