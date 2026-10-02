# CS Umroh — React CRM & Shared Inbox

Rewrite TypeScript dari `csumroh-php`: React SPA, Express REST API, Socket.io, Prisma/MySQL, serta gateway WhatsApp per brand. Aplikasi mendukung role **Super Admin**, **Admin Brand**, dan **Customer Service**.

## Menjalankan lokal

Persyaratan: Node.js 20+, pnpm, dan MySQL 8.

```bash
pnpm install
cp .env.example .env
# sesuaikan DATABASE_URL, secret, dan password bootstrap superadmin
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

`db:seed` hanya membuat akun superadmin awal. Brand, paket, user tim, prospek,
percakapan, dan status WhatsApp tidak pernah dibuat sebagai data contoh; semuanya
berasal dari input operator di aplikasi, MySQL, atau koneksi WhatsApp yang aktif.

Untuk instalasi lama yang pernah memakai seed demo, jalankan sekali:

```bash
pnpm db:clean-demo
```

Web berjalan di `http://localhost:5173`, API di `http://localhost:4000`, dan gateway WA (opsional) di `http://localhost:4001`.

## Akses role

- `superadmin`: lintas brand, mengelola brand, paket, dan user.
- `admin`: hanya satu brand; mengelola paket dan user CS pada brand tersebut.
- `cs`: shared inbox, CRM, Copilot, dan LMS dalam brand sendiri.

Access token hanya disimpan di memory browser. Refresh token dirotasi melalui cookie `httpOnly`, `SameSite=Strict`. Semua query non-superadmin discoping oleh `brandId` dari JWT, bukan input client.

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

Lihat [`prd-csumroh.md`](./prd-csumroh.md) dan [`AGENTS-csumroh.md`](./AGENTS-csumroh.md) sebagai sumber requirement proyek.

## Deploy

Lihat [docs/deploy.md](docs/deploy.md).
