# CS Umroh — CRM & WhatsApp Shared Inbox

CRM holding untuk beberapa brand travel umroh: shared inbox WhatsApp per brand, Pipeline prospek, Copilot script, verifikasi pembayaran, layanan custom, laporan iklan, dan notifikasi realtime. Rewrite TypeScript dari `csumroh-php`.

Stack: React 18 + Vite (`apps/web`), Express + Prisma/MySQL + Socket.io (`apps/api`), gateway WhatsApp Baileys (`apps/wa-gateway`), kontrak dan logika bisnis bersama (`packages/shared-types`), pustaka script JSON (`packages/scripts-data`).

## Menjalankan lokal

Persyaratan: Node.js 20+ (produksi memakai 22), pnpm, dan MySQL 8.

```bash
pnpm install
cp .env.example .env
# sesuaikan DATABASE_URL, secret, dan akun superadmin awal (SEED_SUPERADMIN_*)
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm --parallel --filter @csumroh/api --filter @csumroh/web dev
```

- Skema database dikelola lewat migrasi (`apps/api/prisma/migrations`, `prisma migrate deploy`). Jangan memakai `pnpm db:push` pada database yang juga di-deploy: skema akan melenceng dari riwayat migrasi.
- `pnpm dev` juga menjalankan gateway WhatsApp. Jalankan gateway lokal hanya dengan nomor uji: sesi di `apps/wa-gateway/sessions/` adalah sesi WhatsApp sungguhan, dan dua gateway pada nomor yang sama akan saling memutus.
- `db:seed` hanya membuat akun superadmin awal. Brand, paket, staf, prospek, dan percakapan selalu berasal dari input operator atau koneksi WhatsApp. Instalasi lama yang pernah memakai seed demo: `pnpm db:clean-demo` sekali.
- Akun uji per role untuk pengujian lokal: `pnpm --filter @csumroh/api db:seed:roles` (kata sandi dari `SEED_ROLE_PASSWORD`; skrip menolak berjalan di production atau database non-localhost).

Web berjalan di `http://localhost:5173`, API di `http://localhost:4000`, gateway WA di `http://localhost:4001`.

## Role dan akses brand

| Role | Label UI | Akses utama |
| --- | --- | --- |
| `superadmin` | Super Admin | Semua brand; brand, perangkat WhatsApp, paket, staf, Meta CAPI. Akses brand tidak dibatasi. |
| `admin` | Admin | Data semua brand (peran holding). Brand yang ditugaskan membatasi pengelolaan paket dan notifikasi; tanpa penugasan = semua brand. Paket, staf CS, Meta CAPI, Ringkasan dan Laporan. |
| `cs` | CS | Brand yang ditugaskan (bisa lebih dari satu). Inbox, Pipeline, Copilot, Akademi CS. |
| `finance` | Finance | Semua brand. Verifikasi pembayaran (bukti transfer, koreksi), Ringkasan dan Laporan. |
| `product` | Tim LA | Antrean Layanan custom: menghitung dan mengembalikan harga paket custom. |

Brand milik user (brand utama dan penugasan di `user_brands`) dibawa klaim JWT yang diterbitkan server saat login, lalu ditegakkan di setiap endpoint (`scopedBrandId`); brand dari input client hanya diterima bila termasuk akses user. Socket bergabung ke room `brand:{id}` untuk tiap brand yang boleh diakses, room holding untuk Super Admin/Admin/Finance, dan room pribadi `user:{id}` untuk notifikasi.

Access token hanya disimpan di memory browser. Refresh token dirotasi melalui cookie `httpOnly`, `SameSite=Strict`. Superadmin aktif terakhir dan akun sendiri tidak bisa dinonaktifkan atau diturunkan perannya.

## Alur kerja utama

- **Pipeline:** 9 kolom (`pipelineStatuses` di `packages/shared-types/src/contracts.ts`): Baru → Terhubung → Terkualifikasi → Ditawarkan → Keberatan → Follow-up → Tunggu Verifikasi (`closing`) → Deal, atau Batal. Deal hanya terjadi setelah Finance memverifikasi pembayaran. Status lama (`identifying`, `offered`, `closed_won`, `closed_lost`, `nurture`) dipertahankan untuk data historis.
- **PIC:** lead baru tidak dibagi otomatis. Semua CS brand diberi tahu, dan CS yang pertama membalas menjadi PIC (atau mengklaim dari antrean "Belum ada PIC"). Prospek CS lain hanya bisa diambil alih bila jamaah belum dibalas 15 menit dan sedang jam operasional (08.00–22.00 WIB); di luar jam itu PIC tetap terkunci.
- **Kontak per perangkat:** percakapan terikat ke nomor WhatsApp brand yang menerimanya; prospek perangkat yang terputus disembunyikan sampai tersambung lagi.
- **Gateway WhatsApp:** event ke API melewati antrean tahan-restart (`apps/wa-gateway/outbox/`). Stiker diunduh sebagai media. Telepon/video call jamaah dicatat di chat dan memicu notifikasi Mendesak (CRM tidak bisa mengangkat panggilan).
- **Copilot script:** token `{{…}}` diisi server dari data brand, paket, dan prospek. Data yang kosong tidak diganti teks karangan: script ditandai belum bisa dipakai beserta data yang perlu dilengkapi.
- **Notifikasi in-app:** lonceng, toast, dan suara per tipe (katalog di `packages/shared-types/src/notifications.ts`), ringkasan per brand, dan preferensi per user di Pengaturan Notifikasi.
- **Uang:** CRM mencatat nilai booking dan pembayaran yang diverifikasi Finance; pelunasan dan keuangan lain berada di luar CRM.

## Tracking Meta Ads & CAPI CTWA per brand

Tracking berpusat pada iklan **Click-to-WhatsApp (CTWA)**. Gateway Baileys membaca referral pesan WhatsApp, CRM menyimpan asal iklan, lalu backend mengirim event melalui Conversions API (CAPI) ke Pixel/Dataset Meta. Aplikasi belum memasang browser Pixel `fbq` atau tracking cookie `_fbp`/`_fbc`.

### Konfigurasi dan keamanan

Admin brand atau superadmin dapat membuka halaman **Meta Conversions API** (`/meta-capi`) untuk mengatur konfigurasi khusus brand:

- **Pixel/Dataset ID, Facebook Page ID, dan access token CAPI** wajib untuk pengiriman event; **WhatsApp Business Account ID (WABA)** opsional dalam validasi aplikasi.
- **Ad Account ID dan token Ads** digunakan untuk laporan iklan dan audiens spam. Pembacaan laporan memerlukan izin `ads_read`; pengelolaan audiens memerlukan `ads_management`. Jika token Ads tidak diisi, aplikasi menggunakan token CAPI, yang tetap harus memiliki izin untuk operasi tersebut.
- **Test Event Code** digunakan selama pengujian di Meta Events Manager.
- Token yang disimpan melalui pengaturan dienkripsi dengan AES-256-GCM dan tidak dikirim kembali sebagai teks asli ke browser.
- `META_TOKEN_ENCRYPTION_KEY` minimal 32 karakter wajib diisi saat `NODE_ENV=production`; API menolak startup jika kunci tidak tersedia. Di luar produksi, jika tidak diisi, aplikasi memakai `JWT_REFRESH_SECRET` sebagai material kunci fallback.

### Atribusi dan event otomatis

`ctwa_clid` diambil dari referral valid pertama yang diterima untuk prospek dan tidak ditimpa referral berikutnya. CRM juga menyimpan ID iklan, judul, serta URL sumber jika tersedia, dan menandai sumber prospek sebagai `meta_ads`. ID atau judul iklan tidak digunakan sebagai pengganti click ID. Prospek tanpa `ctwa_clid` tidak dikirim ke CAPI.

| Pemicu | Event Meta | Nilai konversi |
| --- | --- | --- |
| Referral pertama diterima secara realtime; status `new`/`contact` juga dapat memicu | `LeadSubmitted` | `dealValue` jika sudah positif; biasanya tanpa nilai |
| Mencapai `qualified` atau tahap sesudahnya | `QualifiedLead` | `dealValue` jika sudah positif |
| Penawaran, status `offer`/`offered` | `AddToCart` | `dealValue` jika sudah positif |
| Invoice diterbitkan dan masuk `closing` | `InitiateCheckout` | `invoiceAmount`, wajib positif |
| Deal setelah verifikasi Finance, status `deal`/`closed_won` | `Purchase` | Total `dealValue`, wajib positif |

`Purchase` memakai total nilai booking, meskipun pembayaran yang diverifikasi baru DP; nilai ini bukan jumlah kas yang sudah diterima. Pengiriman CAPI membaca snapshot `dealValue` dan `invoiceAmount` pada prospek, tanpa menghitung ulang harga katalog.

Payload menggunakan `action_source: business_messaging`, `messaging_channel: whatsapp`, dan mata uang `IDR` untuk event bernilai. Nomor telepon dinormalisasi dengan asumsi nomor Indonesia. Nomor, nama, kota, dan negara yang disertakan di-hash SHA-256; `ctwa_clid` dikirim apa adanya.

### Pengujian, log, dan batasan pengiriman

1. Simpan konfigurasi, lalu gunakan **Tes koneksi** untuk memeriksa akses ke Pixel/Dataset. Hasil tes koneksi belum membuktikan bahwa event dapat diterima atau diatribusikan.
2. Pastikan ada prospek non-spam dengan nomor telepon dan referral CTWA asli. Pengiriman event uji memakai referral prospek tersebut dan mewajibkan Test Event Code.
3. Periksa respons pengiriman dan Test Events di Meta Events Manager. Event uji `Purchase` dan `InitiateCheckout` memakai nominal contoh. Test Event Code hanya dipakai tombol event uji, jadi boleh tetap tersimpan.

Event otomatis dicatat di `meta_capi_logs` dengan payload, HTTP status, respons Meta, serta status `pending`, `success`, atau `failed`. Status `success` berarti respons HTTP berhasil; atribusi iklan perlu diperiksa di Meta. Hasil tombol event uji ditampilkan langsung dan tidak disimpan sebagai log konversi otomatis.

- **Deduplikasi:** `event_id` tetap per prospek dan jenis event, dengan unique constraint `(brandId, eventId)`. `Purchase` memakai sufiks berdasarkan `closedWonCount`. Event yang sudah berstatus `success` dilewati pada pemicu berikutnya.
- **Mode uji:** event otomatis tidak pernah memakai Test Event Code; kode itu hanya untuk tombol event uji.
- **Kegagalan:** pengiriman berjalan di proses API dengan timeout 15 detik. Event gagal dicoba ulang otomatis tiap 5 menit dengan jeda berlipat (sampai 8 kali, selama event masih ≤ 7 hari), dan lead iklan 7 hari terakhir yang belum pernah terkirim dikirim menyusul. Job ini hanya berjalan bila `NODE_ENV=production`. Admin juga bisa menekan "Kirim ulang" di log event.
- **Spam:** prospek yang sudah ditandai spam dilewati saat pengiriman. Event yang terkirim sebelum penandaan spam tidak dibatalkan.
- **Waktu event:** penawaran, invoice, dan pembelian memakai timestamp bisnis bila tersedia; `LeadSubmitted` memakai waktu pembuatan prospek. `QualifiedLead` masih memakai `updatedAt`, sehingga pengiriman tertunda dapat memakai waktu edit terakhir.

### Laporan iklan dan audiens spam

Laporan menggabungkan biaya, impresi, klik, CTR, dan percakapan dari Marketing API dengan hasil CRM untuk menghitung biaya per lead, biaya per lead terkualifikasi, biaya per deal, serta ROAS. Laporan kreatif mengatribusikan prospek ke iklan dari pesan pertama yang memiliki referral. Lead dihitung berdasarkan tanggal pembuatan prospek, sedangkan transaksi berdasarkan tanggal pembuatan pembayaran terverifikasi; angka CRM dapat berbeda dari atribusi Ads Manager.

Nomor yang ditandai spam dapat disinkronkan dalam bentuk hash ke Custom Audience per brand. Audiens tersebut perlu dipilih sebagai pengecualian pada set iklan di Ads Manager.

## Perintah verifikasi

```bash
pnpm typecheck
pnpm test
pnpm build
```

Aturan desain web (warna, ukuran teks, `<select>`, `confirm()`) dijaga otomatis oleh `apps/web/src/design-rules.test.ts`.

Lihat [`prd-csumroh.md`](./prd-csumroh.md) untuk latar belakang produk dan [`AGENTS-csumroh.md`](./AGENTS-csumroh.md) untuk aturan pengembangan.

## Deploy

Panduan deploy produksi tidak disimpan di repo ini karena memuat detail infrastruktur. Minta ke pengelola server.
