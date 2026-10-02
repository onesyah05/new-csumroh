# AGENTS-csumroh.md
# Panduan & konteks sistem untuk AI coding agent

Proyek: **CS Umroh — CRM holding & WhatsApp Shared Inbox** (React SPA + Node.js/TypeScript).
Pendahulu: `csumroh-php`. Latar belakang produk dan migrasi: `prd-csumroh.md`. Cara menjalankan dan alur kerja ringkas: `README.md`.

Diperbarui 2 Oktober 2026. Bila dokumen ini berbeda dengan kode, **kode yang benar**; perbarui dokumen ini bersama perubahannya.

---

## 1. Tujuan & cakupan

CRM untuk holding dengan beberapa brand travel umroh. Satu aplikasi melayani CS, Admin, Finance, Tim LA, dan Super Admin:

- Shared inbox WhatsApp per brand (gateway Baileys), realtime lewat Socket.io.
- Pipeline prospek (papan + tabel), profil prospek, kualifikasi, penawaran, invoice.
- Copilot script (pustaka JSON, token data server, TGJP).
- Verifikasi pembayaran oleh Finance; Deal hanya setelah verifikasi.
- Layanan custom (CS mengajukan kebutuhan, Tim LA menghitung harga).
- Meta CAPI (CTWA), laporan iklan, audiens spam.
- Notifikasi in-app (lonceng, toast, suara), Akademi CS (LMS), PWA untuk HP.

---

## 2. Lingkungan & runtime

* **Node.js** 20+ (produksi memakai 22). **pnpm** workspaces; jangan campur `npm`/`yarn`.
* **MySQL 8** lewat `DATABASE_URL` di `.env`. Tidak ada kredensial di kode.
* **Port lokal:** web `5173`, API `4000`, gateway `4001` (lihat `.env.example`).
* **Tooling:** `apps/web` Vite + React 18; `apps/api` `tsx watch` (dev) dan `tsc` (build); `apps/wa-gateway` `tsc`.
* **Gateway lokal:** sesi di `apps/wa-gateway/sessions/` adalah sesi WhatsApp sungguhan. Jangan menjalankan gateway lokal bersamaan dengan produksi untuk nomor yang sama (keduanya akan saling memutus). Untuk uji UI, jalankan API + web saja.
* **Minimalism:** jangan menambah bundler, state manager, ORM, atau UI kit pesaing (Vite, Express, Prisma, Socket.io, TanStack Query, Zustand, Radix sudah ditetapkan).

---

## 3. Aturan desain (web)

Monokrom netral; token Tailwind di `apps/web/tailwind.config.ts`, aturan global di `apps/web/src/styles/globals.css`.

* **Warna:** latar `bg-white`, panel `zinc-50/100`, garis `zinc-200/300`, teks `zinc-900/700/500`. Tombol utama `bg-black text-white`, sekunder outline `zinc-300`.
* **Warna semantik saja:** selain hitam/putih/abu, hanya `emerald` (sukses/Deal), `rose` (error/mendesak), dan `amber` (peringatan).
* **Pengecualian:** Inbox (termasuk panel Profil/Copilot di dalamnya) sengaja bergaya WhatsApp Web (hijau) atas keputusan user 24/09/2026.
* **Tanpa `<select>` native** dan tanpa `window.confirm`. Pakai komponen di `apps/web/src/components/ui/`:
  * `Select` (Radix), `Modal` / `ConfirmDialog` / `ModalFrame`, `ImageLightbox`. Radix `Dialog` langsung hanya untuk drawer samping.
  * `Badge` (status prospek) dan `StatusBadge` (status lain).
  * `.surface` untuk wadah polos, `Card`/`CardHeader` untuk seksi berjudul.
  * Toast: `showFeedback(pesan, { error })` dari `app/toast.tsx`.
  * Tampilan kosong: `EmptyState` dari `components/ui/page-feedback.tsx`.
* **Keterbacaan:** teks minimal 12 px (`text-xs`); 11 px hanya angka di lencana hitungan. Teks sekunder di latar terang minimal `zinc-500`; di latar gelap `zinc-400`.
* **Keyboard:** elemen yang bisa diklik harus `<button>`/`<a>`; isi kompleks memakai `role="button"`, `tabIndex={0}`, Enter/Spasi, `focus-visible:ring`.
* **Istilah baku UI:** Staf (bukan Staff), Pipeline, Deal, Batal. Tahap `closing` berlabel "Tunggu Verifikasi". Label menu = breadcrumb = judul halaman.
* Aturan warna, ukuran teks, `<select>`, dan `confirm()` dijaga otomatis oleh `apps/web/src/design-rules.test.ts`.

### Tata letak

* Desktop: halaman harus nyaman di split-screen (~700 px) berdampingan dengan WhatsApp Web. Lebar tabel besar hanya mulai `lg:`; kolom sekunder `hidden lg:table-cell`.
* HP (`max-width: 767px`): semua tombol dan input minimal 44 px (aturan global di `globals.css`). Baris chip yang rapat memakai kelas `mobile-dense` atau `quick-reply-chip` (32 px) dan `mobile-compact-control` (36 px); jangan menimpa tinggi dengan utilitas Tailwind biasa karena kalah oleh aturan global.
* Tabel di HP: teks sel tidak dipatahkan di tengah kata; baris bertumpuk (nama lalu telepon) tetap bertumpuk.
* Filter: kontrol sekunder masuk panel Filter, bukan tambahan di toolbar.
* Perubahan UI diverifikasi di browser (desktop dan HP) sebelum dianggap selesai; perbaiki penyebabnya di seluruh permukaan, bukan satu tempat.

---

## 4. Role, brand, dan PIC

### Role (`enum Role` di `schema.prisma`)

| Role | Akses |
| --- | --- |
| `superadmin` | Semua brand dan seluruh pengaturan. Akses brand tidak dibatasi. |
| `admin` | Data semua brand (peran holding). Penugasan brand membatasi pengelolaan paket dan notifikasi; tanpa penugasan = semua brand. |
| `cs` | Hanya brand utama + penugasan (`user_brands`), bisa lebih dari satu. |
| `finance` | Semua brand; verifikasi pembayaran, Ringkasan, Laporan. |
| `product` (Tim LA) | Antrean Layanan custom. |

### Aturan scope (ditegakkan backend)

1. Brand user dibawa klaim JWT yang diterbitkan server saat login. Setiap endpoint memakai `scopedBrandId` (`apps/api/src/middleware/auth.ts`); brand dari query hanya diterima bila termasuk akses user.
2. Socket bergabung ke `brand:{id}` untuk tiap brand yang boleh diakses, `holding` untuk Super Admin/Admin/Finance, dan `user:{id}` untuk notifikasi pribadi (`apps/api/src/realtime/socket.ts`).
3. Variabel finansial (`{{travel}}`, `{{ppiu}}`, `{{bank}}`, `{{rekening}}`, `{{nama_rekening}}`) selalu diisi server dari brand prospek, tidak pernah dari client.
4. Pengguna tidak bisa menonaktifkan atau menurunkan peran akunnya sendiri maupun superadmin aktif terakhir.

### PIC (penanggung jawab prospek, `prospects.user_id`)

* Lead baru dari jamaah dibagi otomatis ke CS aktif brand dengan prospek terbuka paling sedikit (`apps/api/src/modules/prospects/pic.ts`). Chat baru yang dimulai dari HP brand juga mendapat PIC.
* Lead tanpa PIC **diklaim sendiri** oleh CS. Jangan menambah bulk-assign atau pembagian otomatis untuk lead lama.
* Pengambilalihan prospek CS lain hanya bila jamaah belum dibalas 15 menit.
* Klaim dan pengambilalihan wajib memakai conditional update (`updateMany` dengan syarat), mengembalikan `409` bila sudah diambil CS lain.

### Kontak per perangkat

Percakapan dan prospek terikat ke nomor WhatsApp brand yang menerimanya (`devicePhone`). Prospek perangkat yang terputus disembunyikan sampai tersambung lagi.

---

## 5. Pipeline & uang

* **Kolom Pipeline** (`pipelineStatuses` di `packages/shared-types/src/contracts.ts`): `new` (Baru) → `contact` (Terhubung) → `qualified` (Terkualifikasi) → `offer` (Ditawarkan) → `objection` (Keberatan) → `followup` (Follow-up) → `closing` (Tunggu Verifikasi) → `deal` (Deal) / `lose` (Batal).
* `identifying`, `offered`, `closed_won`, `closed_lost` (`legacyStatuses`) dan `nurture` dipertahankan di enum untuk data lama; **jangan hapus nilai enum tanpa instruksi user**.
* Prospek Baru yang sudah dibalas (dari CRM atau HP) otomatis menjadi Terhubung.
* **Deal hanya setelah Finance memverifikasi pembayaran.** CS tidak bisa menetapkan Deal manual.
* CRM mencatat nilai booking (`dealValue`), invoice, dan pembayaran terverifikasi. Pelunasan dan keuangan lain di luar CRM. Verifikasi bisa dikoreksi (reversal) dengan riwayat.

---

## 6. Script Copilot

* Pustaka asli di `packages/scripts-data/` (JSON). Jangan dihapus atau dirusak; transformasi dilakukan saat runtime.
* POV agen → CS: `{{agent_name}}` → `{{cs_name}}`; "mitra agen" → "tim CS" (`apps/api/src/modules/scripts/scripts.routes.ts`).
* Token diisi server di `apps/api/src/modules/scripts/context.ts` (`TOKEN_INFO`, `buildScriptContext`). Token baru wajib didaftarkan di `TOKEN_INFO` dengan label dan cara melengkapi.
* **Data yang tidak diketahui tidak diganti teks karangan.** Token dibiarkan, script ditandai `blocked` (fakta) atau `needs_context` (isian profil) beserta data yang perlu dilengkapi.
* Daftar fasilitas dan biaya selalu ditulis lengkap, tidak diringkas "dan N lainnya".
* Format WhatsApp bersama di `apps/web/src/features/chat/waFormat.ts`: tebal satu bintang, daftar "•", baris kosong tidak ditulis.

---

## 7. Database

* `apps/api/prisma/schema.prisma` adalah sumber kebenaran; perubahan skema **wajib lewat migrasi** di `apps/api/prisma/migrations/` (deploy memakai `prisma migrate deploy`).
* Jangan memakai `db push` pada database yang di-deploy. Database lokal pernah melenceng karena `db push`; periksa `prisma migrate diff --from-schema-datasource` sebelum migrasi lokal.
* Perbaikan data sekali jalan dibuat sebagai skrip di `apps/api/prisma/` dengan mode pratinjau sebelum menulis.

---

## 8. Struktur monorepo

```
crm-azhan/
├── apps/
│   ├── web/                 # React SPA
│   │   └── src/
│   │       ├── app/         # shell, router, socket, toast, PWA
│   │       ├── features/    # admin, auth, brand, chat, custom, dashboard, finance, lms, meta,
│   │       │                # notifications, packages, prospect-detail, prospects, reports, staff
│   │       ├── components/ui/
│   │       ├── lib/         # api client, scope, csv, notificationSound, hooks
│   │       └── styles/globals.css
│   ├── api/                 # Express REST + Socket.io
│   │   ├── prisma/          # schema, migrations, seed, skrip data
│   │   └── src/
│   │       ├── modules/     # ads, auth, capi, catalog, chat, contacts, custom, dashboard,
│   │       │                # finance, notifications, prospects, reports, scripts, whatsapp
│   │       ├── jobs/  middleware/  realtime/  db/  config/  utils/
│   │       └── server.ts
│   └── wa-gateway/          # Baileys, proses terpisah
│       └── src/             # server, messages (pesan/panggilan), connection, outbox, referral
├── packages/
│   ├── shared-types/        # kontrak, logika bisnis bersama, katalog notifikasi, interpolasi script
│   └── scripts-data/        # pustaka script JSON
├── docs/                    # diabaikan git; catatan lokal (deploy, backlog)
├── AGENTS-csumroh.md
├── prd-csumroh.md
└── README.md
```

* Gateway → API lewat HTTP internal (`/internal/*`, header `x-internal-secret`), melalui antrean tahan-restart `apps/wa-gateway/outbox/`. Endpoint baru di gateway harus punya pasangan di `internalRouter` API.
* Event socket utama: `message:new`, `message:edited`, `message:status`, `prospect:updated`, `prospect:claimed`, `whatsapp:status`, `notification:new`, `notification:updated`.

---

## 9. Aturan kerja untuk AI agent

1. **Tidak commit atau push** tanpa instruksi eksplisit user.
2. **Hanya kerjakan yang diminta.** Temuan di luar cakupan dilaporkan, bukan langsung diubah.
3. **Tidak ada secret di kode.** Semua kredensial lewat `.env`; `.env.example` tanpa nilai asli. Temukan secret di kode → berhenti dan tanya.
4. **Repo ini publik.** Jangan commit detail infrastruktur (IP server, panel hosting, nama service, panduan deploy). Catatan semacam itu di `docs/` (diabaikan git).
5. **Query lewat Prisma.** Raw SQL hanya dengan `Prisma.sql`/parameter binding.
6. **Unit test wajib** untuk logika bisnis kritikal: transisi status pipeline, kalkulasi nilai booking/pax, konteks dan status script, payload Meta CAPI, scope brand, klaim PIC, notifikasi, dan pemetaan event gateway.
7. **Klaim PIC aman konkuren** (conditional update).
8. **CORS & auth:** tidak ada `origin: '*'`; access token tidak disimpan di `localStorage`.
9. **Produksi:** jangan mengubah data produksi atau menjalankan deploy tanpa persetujuan user untuk tindakan itu.
10. **Verifikasi sebelum melapor:** `pnpm typecheck`, `pnpm test`, dan untuk UI cek langsung di browser (desktop dan HP).
