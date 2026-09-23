# Perbaikan atas Re-audit 23 September 2026 — Tahap 1

Acuan: [re-audit-crm-azhan-holding-2026-09-23.md](re-audit-crm-azhan-holding-2026-09-23.md). Tahap ini mengerjakan urutan prioritas 1 (integritas transaksi & regresi operasional). **Belum ada sign-off operasional**: migrasi belum dijalankan ke database mana pun, dan belum ada uji browser terautentikasi atau uji concurrency pada MySQL terisolasi.

## Status per temuan

| Temuan | Status | Perubahan |
| --- | --- | --- |
| R01 invoice/offer mengubah kas | Diperbaiki | Kolom baru `invoiceAmount` (tagihan) terpisah dari `dpAmount` (kas terverifikasi). `/invoice` tidak lagi menulis `dpAmount`. `/offer` menghitung nilai dari katalog (`packageBookingValue`); override hanya admin/finance dan tercatat di log. Offer ditolak (409) untuk booking Deal; paket/pax booking Deal terkunci di `/profile` dan `/invoice`. |
| R02 approval paralel & akumulasi | Diperbaiki (handler) | Tabel ledger `payments` (satu baris per mutasi, `idempotencyKey` unik, `referenceNo` unik per brand). Kemenangan diklaim dengan conditional `updateMany(status notIn deal)`; kuota dipotong dengan `updateMany(quotaRemaining >= seat)` + cek jumlah baris. `dpAmount` = kumulatif (increment). Pelunasan → `paid_full`; Purchase CAPI hanya pada kemenangan baru. Pembatalan Deal (khusus finance/admin) melepas `seatsReserved` ke kuota. |
| R03 “terkirim” tanpa pengiriman | Diperbaiki | Logika kirim diekstrak ke `chat/outbound.ts`. Offer/invoice dengan `sendViaWhatsApp:true` wajib membawa `messageText`, dikirim lewat gateway, dan baru mencatat `offerSentAt`/`invoiceSentAt` + `offerMessageId`/`invoiceMessageId` + stage + CAPI bila gateway sukses. Default flag = draft. Draft di Pipeline disalin ke clipboard (tidak ada composer). Manual ke `closing` mensyaratkan invoice benar-benar terkirim. |
| R04 simpan profil detail 403 | Diperbaiki | Kontrak `prospectProfileSchema` (zod) dipakai backend; field settlement yang dikirim dengan nilai sama dianggap no-op, perubahan nyata ditolak 403 untuk semua role. Halaman detail tidak lagi mengirim `dealValue/dpAmount/paymentStatus`; editor settlement diganti ringkasan read-only. |
| R05 preview bukti bayar privat | Diperbaiki | `api.blob()` mengambil berkas dengan Bearer + refresh; `PrivateProofPreview/Thumb` merender gambar atau PDF via object URL dan membersihkannya. Route berkas memeriksa asosiasi berkas↔prospek (atau ledger) dan hak brand. Route lama `/payment-proof` hanya menerima path berkas privat milik prospek itu; data URL ditolak. Modal upload hanya file (JPG/PNG/WEBP/PDF, 5MB). Proxy Vite `/api` ditambahkan. |
| R07 filter tanggal | Diperbaiki | `dateOnlyKey` + `businessDateKey` (Asia/Jakarta) di shared-types; filter backend today/overdue/unassigned memakainya dan mengecualikan Deal/Lose. Pipeline memakai endpoint untuk antrean “hari ini / terlambat / belum ada PIC”. SLA/eskalasi A09 **belum**. |
| R08 containment media | Sebagian | `isPathInside` berbasis `path.relative` (bukan prefix). Flyer hanya URL `/uploads/packages/<file>.(jpg|png|webp)` (validasi katalog + resolver), paket harus satu brand. **Belum**: media chat masih di `/uploads/media` publik. |
| R09 migrasi | Dibuat, belum diuji di DB | `20260922000000_sync_schema_drift` (drift yang sudah ada sebelum tahap ini) dan `20260923120000_payment_ledger` (kolom/ledger baru + backfill). Keduanya digenerate dengan `prisma migrate diff` dari schema HEAD (identik dengan migrasi init). |
| R10 dashboard & CAPI | Sebagian | Menang hanya dari status Deal. Piutang dan kelebihan bayar dihitung per booking; kas pada booking batal dilaporkan terpisah (`cashOnCancelled`). Admin mendapat holding view. CAPI: tanpa fallback harga paket, InitiateCheckout memakai `invoiceAmount`, event_time dari timestamp bisnis, test-event wajib test code. **Belum**: outbox durable, cohort/periode. |
| A16 transisi | Sebagian | `canTransitionStatus`: Deal hanya boleh ke lose. Objection/activities tidak menurunkan Deal. |
| A08 target assign | Sebagian | Target assign/handover harus CS aktif dengan akses brand prospek. UI assign/handover belum. |
| R06 scope multi-brand | Sebagian | Route per-prospek me-resolve brand dari prospek lalu divalidasi `scopedBrandId` (CS brand kedua tidak lagi 404). Detail page tidak lagi memaksa brand utama. **Belum**: hook scope, socket room multi-brand, selector dashboard holding, CRUD role finance. |

## Bukti pengujian

| Pemeriksaan | Hasil |
| --- | --- |
| `tsc --noEmit` shared-types, API, web, gateway | Lulus |
| Tes shared-types | 9/9 |
| Tes API (termasuk `prospects.routes.test.ts` 17 skenario handler, `safe-path.test.ts`) | 34/34 |
| Tes web | 3/3 |
| `vite build` | Lulus (warning ukuran chunk tetap) |
| Diagnostik re-audit `scratch/reaudit.audit.ts` | 8/9 lulus (sebelumnya 2/9) |

`prospects.routes.test.ts` menjalankan handler Express asli terhadap store in-memory yang meniru semantik yang diandalkan handler: jumlah baris `updateMany` bersyarat, unique key (P2002), serialisasi transaksi, dan rollback. Ini **bukan** bukti locking InnoDB.

Diagnostik re-audit hanya disesuaikan pada boundary mock (operasi DB baru dan modul `outbound.js`); expected result tidak diubah. Satu yang tetap gagal, *A02: cannot mark an offer sent…*, mengharapkan HTTP 200 untuk kirim tanpa naskah; handler kini menolak dengan 422 dan tidak mencatat apa pun (`offerSentAt` tetap kosong). Premis “tidak ada operasi delivery” tidak berlaku lagi.

## Langkah penerapan database (belum dijalankan)

Database fresh:

```bash
pnpm db:migrate
```

Database lokal `crm_azhan` (dicek read-only 23/09): `20260921074239_init` sudah tercatat di `_prisma_migrations`, lalu drift ditambahkan via `db push`; kolom ledger tahap ini belum ada. Tandai migrasi drift sebagai terpasang, lalu deploy ledger. Lakukan pada **salinan** dahulu dan cek `prisma migrate status`. Jangan `resolve` migrasi init yang sudah tercatat.

```bash
cd apps/api
npx prisma migrate resolve --applied 20260922000000_sync_schema_drift
npx prisma migrate deploy
```

**Status lokal (23/09 malam):** sebelum migrasi dijalankan, skema `crm_azhan` sudah diubah lewat `db push` hingga identik dengan `schema.prisma` (`prisma migrate diff --from-schema-datasource` kosong). Karena itu kedua migrasi hanya ditandai terpasang dengan `migrate resolve --applied`; `migrate status` = up to date. Backfill tidak perlu dijalankan: tidak ada prospek dengan DP, invoice, bukti, atau Deal, dan tabel `payments` kosong. Backup `mysqldump` sebelum perubahan: `scratch/db-backup/crm_azhan-before-migrate-20260923-201137.sql`.

Untuk database lain (staging/produksi): cek dulu `migrate diff --from-schema-datasource` — bila kolom belum ada, jalankan `migrate deploy` (termasuk backfill); bila sudah di-`db push`, jalankan backfill SQL secara manual pada salinan data sebelum `resolve --applied`.

Backfill di migrasi ledger: `invoice_amount` diisi dari `dp_amount` lama untuk prospek yang punya invoice; `dp_amount` dinolkan untuk prospek yang belum diverifikasi Finance dan belum Deal; saldo kas tersisa dicatat sebagai satu baris ledger `LEGACY`; `seats_reserved` diestimasi dari pax booking Deal berpaket. Periksa hasil backfill pada salinan data sebelum dipakai untuk laporan.

Setelah pull, hentikan server API dev lalu jalankan `pnpm db:generate` (DLL query engine Prisma terkunci selama server berjalan).

## Sisa pekerjaan (tahap berikutnya)

1. Uji migrasi pada DB kosong dan salinan data; integration test concurrency di MySQL terisolasi.
2. R06 penuh: hook scope, socket room per UserBrand/holding, selector dashboard “semua brand”, role finance di CRUD staf.
3. R08: pindahkan media chat ke storage privat dan akses terautentikasi.
4. Outbox persisten untuk pesan keluar dan CAPI (A11/A13), refund/reversal ledger, UI assign/handover, SLA follow-up, pagination (A19), LMS per staf (A24).

## Alur verifikasi pembayaran (pembaruan 23/09)

- **Menu "Verifikasi"** (`/verifikasi`, Finance/Admin/Superadmin) menggantikan pencarian manual lewat Pipeline. Data dari `GET /api/v1/verification/queue?brandId=all|<id>`:
  - *Bukti diajukan*: `paymentProofUrl` yang belum dipakai pembayaran terverifikasi mana pun, termasuk bukti pelunasan booking Deal.
  - *Kandidat dari chat*: gambar/PDF masuk dari jamaah setelah invoice terkirim (atau setelah pembayaran terakhir), belum pernah dipakai sebagai bukti. Tidak otomatis dianggap bukti karena jamaah juga mengirim KTP/paspor.
- **Bukti langsung dari chat**: `POST /prospects/:id/payment-proof-from-message { messageId }` menyalin berkas `uploads/media` ke storage privat di server (validasi percakapan yang sama, containment path, magic bytes, 15MB). Dipakai dari menu Verifikasi ("Jadikan bukti") dan dari menu pesan di Inbox ("Kirim ke Finance sebagai bukti transfer"). Upload manual tetap ada untuk bukti dari luar WhatsApp.
- Kolom baru di migrasi ledger (belum dijalankan): `prospects.payment_proof_message_id`, `prospects.payment_proof_submitted_at`, `payments.proof_message_id`; backfill menandai bukti lama milik booking berbayar sebagai sudah terverifikasi.
