# Audit Frontend CRM Azhan (apps/web) — 23 September 2026

**Keputusan: frontend belum siap dipakai operasional holding.** Build dan typecheck bersih, tetapi ada tiga temuan P1 yang langsung berdampak pada data/akses (demosi role saat edit staf, media chat jamaah ikut ter-bundle ke build publik, dan pesan otomatis yang mengarang rekening/klaim), ditambah celah sesi/realtime yang membuat CS kehilangan pembaruan setelah 15 menit. Pengawasan multi-brand (R06 re-audit) juga masih belum tersambung di UI.

## 1. Cakupan, metode, dan batas

| Area | Metode |
| --- | --- |
| Seluruh `apps/web/src` (≈19.600 baris, 60 berkas) | Review statis: routing & gating role, auth/token, socket, pemakaian API, formulir, modal, aksesibilitas, kepatuhan `UI_GUIDELINES.md` dan `AGENTS-csumroh.md` |
| Build | `tsc --noEmit` lulus; `vite build` lulus, satu chunk JS 928 kB (tanpa code splitting) + CSS 75 kB |
| Tes | 3 tes (navigasi, panel perangkat WA); tidak ada tes untuk inbox, pipeline, modal keuangan, staf |
| Browser (dev server lokal) | Halaman login: label, `lang="id"`, tanpa scroll horizontal di 700px dan 375px. **Halaman terautentikasi tidak diuji**: auditor tidak memasukkan kredensial. |
| Database lokal | Dicek read-only untuk memastikan kompatibilitas API dengan kode terbaru (lihat F03) |

Tidak ada perubahan kode aplikasi dalam audit ini. Satu koreksi dilakukan pada dokumen `perbaikan-reaudit-2026-09-23.md` (langkah deploy migrasi, lihat F03).

## 2. Temuan

Tingkat: **P1** = kerugian data/akses/keuangan atau fitur inti rusak; **P2** = risiko nyata, perlu sebelum rollout; **P3** = kualitas/maintainability.

### F01 — P1 — Edit staf menurunkan role finance/superadmin menjadi CS

Form staf hanya mengenal `admin`/`cs`. Saat membuka akun untuk diedit, role selain `admin` dipaksa menjadi `cs` ([StaffPage.tsx:182](../apps/web/src/features/staff/StaffPage.tsx:182)), dan superadmin selalu mengirim `role` pada PATCH. Backend menerima dan menyimpannya ([catalog.routes.ts:595](../apps/api/src/modules/catalog/catalog.routes.ts:595)).

Skenario: superadmin mengganti nama akun Finance → akun itu menjadi CS dan kehilangan akses verifikasi. Superadmin yang mengedit **akunnya sendiri** (baris superadmin dapat dikelola, `canManage = isSuperadmin`) juga turun menjadi CS.

Perbaikan: role hanya dikirim bila diubah secara eksplisit; tambahkan `finance` di form, filter, dan badge; blok edit role untuk diri sendiri dan akun superadmin; backend menolak perubahan role superadmin dan menerima `finance`.

### F02 — P1 — Media chat jamaah ikut masuk ke build publik

`apps/web/public/uploads/chat/` berisi dua foto percakapan masuk (`1_in_…jpg`) dan `public/uploads/flyers/` berisi flyer. Vite menyalin `public/` apa adanya, sehingga berkas itu sudah ada di `dist/uploads/chat/` dan akan disajikan tanpa autentikasi di mana pun build di-deploy. Direktori ini untracked tetapi tidak ada di `.gitignore`, jadi mudah ikut ter-commit.

Perbaikan: hapus `apps/web/public/uploads`, tambahkan ke `.gitignore`, bersihkan `dist`. Media percakapan harus disajikan API melalui akses terautentikasi (sejalan dengan R08).

### F03 — P1 — API dengan kode terbaru gagal membaca prospek di database lokal

Kode tahap 1 (ledger) sudah aktif, tetapi database `crm_azhan` belum memiliki `invoice_amount`, `seats_reserved`, dll. Query uji read-only gagal: `The column crm_azhan.prospects.invoice_amount does not exist`. Begitu server API dev memuat ulang Prisma client baru, Inbox, Pipeline, Detail, dan Dashboard akan error.

`_prisma_migrations` sudah mencatat `20260921074239_init`, sehingga langkah deploy sebelumnya (`resolve --applied` untuk init) keliru; dokumen status sudah dikoreksi: cukup `resolve --applied 20260922000000_sync_schema_drift` lalu `migrate deploy`, pada salinan dahulu.

### F04 — P1 — Template pesan mengarang rekening, legalitas, dan kelangkaan

Quick reply di Inbox ([InboxPage.tsx:366](../apps/web/src/features/chat/InboxPage.tsx:366)–373):

- Rekening: bila brand belum punya data bank, teks tetap menyebut **"Bank: Bank Mandiri"** dengan nomor `-` dan pemilik = nama travel. Jamaah dapat mentransfer ke rekening yang salah.
- Legalitas: tanpa nomor PPIU, teks mengklaim "Resmi Terdaftar Kemenag RI".
- "Dorong Closing": selalu mengklaim "kuota seat … tersisa sangat terbatas" tanpa membaca kuota paket.

Ini bertentangan dengan aturan AGENTS §4.6 (variabel keuangan diresolve backend dari brand). Perbaikan: template keuangan/legal diambil dari endpoint skrip backend; bila data brand kosong, tombol dinonaktifkan dengan pesan "lengkapi data brand"; klaim kuota hanya dari `quotaRemaining` nyata.

### F05 — P2 — Sesi 15 menit memutus realtime dan memicu logout acak

- Socket memakai token saat login dan tidak pernah memperbaruinya ([socket.tsx:11](../apps/web/src/app/socket.tsx:11)). Access token berlaku 15 menit; reconnect setelah itu ditolak `unauthorized` dan realtime mati diam-diam (tidak ada indikator, tidak ada retry dengan token baru).
- Refresh HTTP tidak single-flight ([api.ts:14](../apps/web/src/lib/api.ts:14)). Inbox menjalankan beberapa query sekaligus (status WA tiap 5 detik, percakapan, pesan); setelah token kedaluwarsa, beberapa request me-refresh bersamaan. Refresh token dirotasi di backend, jadi request kedua memakai token yang sudah dicabut dan gagal → error "Sesi berakhir" muncul di tengah pekerjaan. Backend juga dapat menerbitkan dua refresh token karena cek dan revoke tidak atomik.
- Bila refresh gagal, `user` tidak dikosongkan; aplikasi menampilkan error per halaman alih-alih kembali ke login.

Perbaikan: satu promise refresh bersama; `auth` memakai callback socket (`auth: (cb) => cb({ token: getAccessToken() })`) dan reconnect setelah refresh; logout terpusat pada 401 final; indikator status koneksi realtime.

### F06 — P2 — Pengawasan multi-brand belum tersambung (R06 dari re-audit)

- Hanya superadmin yang punya `activeBrandId` ([scope.ts](../apps/web/src/lib/scope.ts)); admin/finance/CS multi-brand selalu terkunci ke brand utama. Pemilih brand di Inbox hanya untuk superadmin.
- AppShell memilih brand pertama otomatis untuk superadmin ([AppShell.tsx:38](../apps/web/src/app/AppShell.tsx:38)), sehingga Dashboard selalu mengirim `brandId` dan **holding view tidak pernah tampil**; tidak ada pilihan "Semua brand". Finance/admin juga selalu mengirim brand utama.
- Dashboard belum menampilkan field baru `totalOverpayment` dan `cashOnCancelled`; teks "Semua kontak dari 5 brand" di-hardcode ([DashboardPage.tsx:73](../apps/web/src/features/dashboard/DashboardPage.tsx:73)).
- Finance tidak punya antrean verifikasi: navigasi finance sama dengan CS, bukti bayar baru dicari manual lewat Pipeline.

### F07 — P2 — Inbox kosong saat WhatsApp terputus

`selected` dan daftar percakapan dikosongkan ketika sesi tidak `connected` ([InboxPage.tsx:279](../apps/web/src/features/chat/InboxPage.tsx:279), [:318](../apps/web/src/features/chat/InboxPage.tsx:318), [:523](../apps/web/src/features/chat/InboxPage.tsx:523)), padahal API history sudah tidak mensyaratkan koneksi. Saat gateway putus, CS tidak dapat membaca riwayat maupun profil untuk menjawab lewat telepon. (A10 re-audit.)

Perbaikan: tetap tampilkan daftar dan riwayat dalam mode baca; hanya composer yang dikunci dengan banner "WhatsApp terputus".

### F08 — P2 — Konfigurasi URL API tidak terbaca di build

`VITE_API_URL`/`VITE_SOCKET_URL` ada di `.env` root, tetapi `vite.config.ts` tidak menetapkan `envDir` dan `apps/web` tidak punya `.env`. Vite tidak membaca `.env` root, sehingga build selalu memakai fallback `http://localhost:4000` ([api.ts:3](../apps/web/src/lib/api.ts:3), [socket.tsx:12](../apps/web/src/app/socket.tsx:12)); bundle berisi literal itu. Build produksi akan memanggil localhost di browser pengguna.

Perbaikan: `envDir: '../../'` atau `.env` per app; gagalkan build produksi bila variabel tidak ada.

### F09 — P2 — CSV export rentan formula injection

Export Pipeline ([PipelinePage.tsx:227](../apps/web/src/features/prospects/PipelinePage.tsx:227)) menulis nama/kota dari WhatsApp apa adanya. Nama kontak dikendalikan pihak luar; nilai seperti `=HYPERLINK(...)` dieksekusi saat dibuka di Excel/Sheets. Perbaikan: prefiks `'` untuk nilai yang diawali `= + - @ \t \r`, dan BOM UTF-8 agar huruf non-ASCII terbaca di Excel.

### F10 — P2 — Upload media tidak konsisten dengan batas server

Frontend mengizinkan berkas hingga 50 MB ([InboxPage.tsx:756](../apps/web/src/features/chat/InboxPage.tsx:756)) lalu mengirimnya sebagai base64 di JSON. Base64 membengkakkan ukuran ~33%, sedangkan server membatasi body 50 MB ([server.ts:25](../apps/api/src/server.ts:25)); berkas >~37 MB selalu gagal 413 setelah upload panjang, dan seluruh berkas ditahan di memori browser dan API. Perbaikan: batas frontend = batas server efektif, atau upload multipart/stream.

### F11 — P2 — Modal transaksi tidak aksesibel

Tujuh modal alur penjualan/keuangan (Qualification, Offer, Objection, Invoice, PaymentProof, FinanceVerify, LostReason) adalah `div fixed inset-0` buatan sendiri: tanpa `role="dialog"`/`aria-modal`, tanpa focus trap, tanpa tombol Escape, fokus tidak kembali ke pemicu (0 handler Escape dan 0 `role="dialog"` di seluruh `src`). Pengguna keyboard dapat men-tab ke halaman di belakang modal dan menekan aksi lain saat verifikasi berlangsung. AGENTS §3 mewajibkan Radix Dialog; 12 berkas lain sudah memakainya.

### F12 — P2 — Status Kanban legacy tidak terlihat

Kolom Kanban hanya `pipelineStatuses` ([PipelinePage.tsx:48](../apps/web/src/features/prospects/PipelinePage.tsx:48)) dan kartu dicocokkan secara literal. Prospek berstatus `identifying`, `offered`, `closed_won`, `closed_lost`, `nurture` tidak muncul di papan mana pun, tetapi tetap dihitung di Dashboard. (A16 re-audit.) Perbaikan: pemetaan legacy → kolom kanonik di satu helper bersama, atau migrasi data status.

### F13 — P3 — Indikator dan kode yang menyesatkan

- Badge "Sistem aktif" hijau di header selalu tampil dan tidak membaca status apa pun ([AppShell.tsx:363](../apps/web/src/app/AppShell.tsx:363)).
- `ContactsPage` (550 baris) tidak punya route; `AdminPage` (1.034 baris) diimpor tetapi route-nya redirect ke `/`, jadi ikut ter-bundle tanpa bisa dibuka.
- Route `/brands`, `/devices`, `/staff`, `/meta-capi` hanya menolak role `cs`; finance dapat membukanya lewat URL walau menu tersembunyi. Backend tetap menegakkan izin, tetapi finance akan melihat halaman error.
- Progres LMS di `localStorage` satu key, tidak per staf ([LmsPage.tsx:11](../apps/web/src/features/lms/LmsPage.tsx:11)). (A24 re-audit.)

### F14 — P3 — Performa dan skala

- Satu bundle 928 kB tanpa `React.lazy`; halaman admin/paket/Meta dimuat untuk semua CS. Zod ikut ter-bundle melalui `@csumroh/shared-types`.
- Inbox memuat semua percakapan dan seluruh riwayat pesan tanpa paginasi/virtualisasi; setiap event socket meng-invalidasi enam keluarga query sekaligus ([socket.tsx:14](../apps/web/src/app/socket.tsx:14)). Pada brand ramai ini menghasilkan refetch berantai. (A19 re-audit.)
- Status WA di-poll tiap 5 detik per tab terbuka, padahal event `whatsapp:status` sudah dikirim lewat socket.
- `history-sync` (POST dengan efek samping) dijalankan sebagai `useQuery` setiap ganti percakapan.

### F15 — P3 — Kepatuhan pedoman UI dan kualitas kode

- `<select>` native masih dipakai di `ContactsPage` dan `PackageFormModal` (dilarang AGENTS §3 dan UI_GUIDELINES §2D).
- 127 pemakaian `any`; 25 toast memakai `setTimeout` tanpa pembersihan (toast lama dapat menghapus toast baru).
- 150 `<button>` dan hanya 33 `aria-label`; sebagian tombol ikon (tutup modal, hapus pencarian) tanpa label.
- Enter pada composer tidak mengecek `isComposing` (input IME).
- Tautan `gmapsUrl` brand dirender tanpa validasi skema di halaman detail ([BrandDetailPage.tsx:231](../apps/web/src/features/brand/BrandDetailPage.tsx:231)); React 18 masih mengizinkan `javascript:` (hanya peringatan). Risiko terbatas karena hanya superadmin yang mengisi, tetapi validasi `https:` sebaiknya ada di backend dan frontend.

## 3. Yang sudah baik

- Tidak ada `dangerouslySetInnerHTML`, `eval`, atau token yang disimpan di `localStorage`; access token hanya di memori, refresh token di cookie httpOnly.
- Tautan eksternal memakai `rel="noopener noreferrer"`; `resolveMediaUrl` tidak meneruskan skema `javascript:`.
- Bukti bayar privat dibaca dengan Bearer token dan object URL yang dibersihkan (perbaikan tahap 1).
- Halaman login berlabel lengkap dan responsif di 375–700px; error boundary per route dengan reset saat navigasi.
- Mutasi keuangan tidak lagi mengirim field settlement dari profil; nilai penawaran mengikuti perhitungan backend.

## 4. Urutan perbaikan yang disarankan

1. **Segera:** F01 (role staf), F02 (hapus media dari `public/`), F03 (jalankan migrasi pada salinan lalu lokal), F04 (template rekening/legalitas).
2. **Sebelum rollout:** F05 sesi/socket, F08 konfigurasi env, F06 scope holding + antrean finance, F07 inbox offline, F09 CSV, F10 batas upload, F11 modal Radix, F12 status legacy.
3. **Berikutnya:** F13–F15, code splitting, paginasi Inbox, tes komponen untuk alur penawaran → invoice → bukti → verifikasi dan edit staf.

## 5. Kriteria penutupan

| Skenario | Hasil wajib |
| --- | --- |
| Superadmin mengedit nama akun Finance dan akunnya sendiri | Role tidak berubah |
| `vite build` dari checkout bersih | `dist` tanpa media chat; URL API dari env produksi |
| Brand tanpa data rekening, CS klik "Rekening Resmi" | Tidak ada teks rekening; muncul peringatan lengkapi data brand |
| CS membiarkan Inbox terbuka 30 menit lalu jaringan putus-sambung | Realtime pulih, tidak ada error "Sesi berakhir", tidak logout |
| Finance/admin holding membuka Dashboard | Dapat memilih "Semua brand"; total = jumlah rincian per brand |
| WhatsApp brand terputus | Riwayat dan profil tetap terbaca; hanya pengiriman yang dikunci |
| Export CSV berisi nama `=1+1` | Terbuka sebagai teks di Excel |
| Navigasi keyboard pada modal Verifikasi Finance | Fokus terkunci di modal, Escape menutup, fokus kembali ke pemicu |
| Prospek berstatus legacy | Tampil di kolom Kanban yang benar |

## 6. Status perbaikan (23 September 2026, sesi lanjutan)

| Temuan | Status | Perubahan |
| --- | --- | --- |
| F01 role staf | Diperbaiki | Form menampilkan role apa adanya dan mengenal `finance`; role hanya dikirim bila diubah; role superadmin terkunci. Backend menerima `finance`, menolak perubahan role superadmin, role diri sendiri, dan perubahan role oleh non-superadmin. |
| F02 media di `public/` | Diperbaiki | `apps/web/public/uploads` dipindahkan keluar repo (salinan identik tetap di `apps/api/uploads`), ditambahkan ke `.gitignore`. `apps/web/dist` lama masih berisi salinan sampai build ulang. |
| F03 migrasi lokal | Selesai (23/09) | Skema DB lokal ternyata sudah sama dengan `schema.prisma` (diubah lewat `db push`); `migrate diff` kosong, sehingga kedua migrasi ditandai terpasang (`migrate resolve`). Backup sebelum perubahan di `scratch/db-backup/`. |
| F04 template | Diperbaiki | Rekening dan PPIU hanya dari data brand; bila kosong tidak ada teks, muncul peringatan. Klaim kuota hanya dari `quotaRemaining`. Modal invoice tidak bisa dikirim/draft tanpa rekening brand lengkap. |
| F05 sesi & realtime | Diperbaiki | Refresh single-flight dan logout terpusat saat refresh ditolak; socket membaca token per handshake, reconnect setelah refresh, sinkron ulang data setelah reconnect; indikator header menampilkan status realtime nyata. |
| F06 multi-brand | Sebagian | Pemilih brand untuk semua role yang punya >1 brand (header + Inbox); socket join semua brand penugasan / room holding; Dashboard punya mode "Semua brand" (default untuk superadmin/admin/finance) dan menampilkan kelebihan bayar & dana booking batal; Pipeline punya antrean "Menunggu verifikasi" (default Finance). Belum: antrean bukti pelunasan untuk booking yang sudah Deal. |
| F07 inbox offline | Diperbaiki | Daftar, riwayat, dan profil tetap tampil saat WA terputus; hanya pengiriman, reaksi, dan template yang dikunci dengan banner. |
| F08 env | Diperbaiki | `envDir` = root monorepo; build produksi gagal bila `VITE_API_URL`/`VITE_SOCKET_URL` kosong; proxy dev mengikuti env. |
| F09 CSV | Diperbaiki | `lib/csv.ts` (awalan `'` untuk sel formula, BOM UTF-8) + tes. |
| F10 upload | Diperbaiki | Batas frontend 30 MB (batas efektif base64 di body 50 MB ±37 MB). |
| F11 modal | Diperbaiki | Tujuh modal transaksi memakai `ModalFrame` (Radix Dialog): role dialog, focus trap, Escape, fokus kembali. |
| F12 status legacy | Diperbaiki | `canonicalStatus()` di shared-types; Kanban memetakan status lama ke kolom kanonik. |
| F13 | Sebagian | Badge statis diganti status realtime; route pengelolaan hanya superadmin/admin (juga form paket). `ContactsPage` dan `AdminPage` belum dihapus/dirutekan. |
| F14 | Sebagian | Code splitting per route (`React.lazy`) dengan Suspense di dalam shell. Paginasi Inbox dan pengurangan invalidasi massal belum. |
| F15 | Sebagian | `<select>` native di `PackageFormModal` diganti `Select` (+ dukungan `aria-label`); Enter menghormati IME; `gmapsUrl` divalidasi http(s) di backend dan detail brand. Belum: `any`, toast `setTimeout`, label tombol ikon lain. |

Tambahan di luar daftar: `GET /catalog/brands`, `GET /catalog/brands/:id`, dan `GET /whatsapp/status` sebelumnya mengirim `qrCode` pairing WhatsApp ke semua role; kini hanya superadmin/admin. QR yang terbaca CS memungkinkan sesi WA brand ditautkan ke perangkat lain.
