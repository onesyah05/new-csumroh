-- Role Designer: hanya mengunggah flyer paket (tanpa akses prospek/chat).
ALTER TABLE `users` MODIFY `role` ENUM('superadmin', 'admin', 'cs', 'finance', 'product', 'designer') NOT NULL DEFAULT 'cs';
