# Product Requirements Document (PRD)
# CS Umroh Copilot, CRM Enterprise & WhatsApp Shared Inbox
## React SPA + Node.js/TypeScript Edition (Multi-Brand)

## 0. Status Dokumen & Konteks Migrasi

Dokumen ini adalah PRD untuk **rewrite arsitektur** dari sistem `csumroh-php` (PHP 8.3 native + Alpine.js/Tailwind CDN, tanpa build step) menjadi **React SPA (frontend) + Node.js/TypeScript (backend)** dengan real-time WebSocket dan fondasi API yang siap dipakai aplikasi mobile di masa depan.

Requirement bisnis & fungsional di dokumen ini **mengacu langsung** pada `prd.md` versi PHP yang sudah tervalidasi berjalan di operasional CS sehari-hari untuk 5 brand travel umroh — bukan didesain ulang dari nol. Yang berubah adalah **arsitektur teknis**, bukan proses bisnisnya. Tim developer & AI code agent yang mengerjakan versi ini wajib mempertahankan seluruh alur kerja, terminologi, dan formula bisnis yang sudah ada (NPGD, MRBVA, CRA, TGJP, 8 tahapan pipeline, shared inbox, claim PIC) kecuali disebutkan eksplisit berubah di dokumen ini.

### Alasan Migrasi
1. **Real-time chat yang benar-benar push**, bukan polling `setInterval`+`fetch` seperti versi PHP (yang secara implementasi bukan SSE walau begitu klaim di dokumentasi lama).
2. **Tim developer akan bertambah** — butuh struktur kode modular, type-safe (TypeScript end-to-end), dan testable, menggantikan file monolitik (`chat.php` >3.600 baris).
3. **Rencana aplikasi mobile** untuk sistem CS umroh ini — butuh backend API + auth token (bukan session cookie PHP) yang bisa dipakai bersama oleh web maupun mobile app tanpa membangun backend dua kali.

### Prinsip Migrasi
Bangun baru dengan arsitektur target (Node.js/TypeScript penuh, termasuk WhatsApp gateway), **tapi bawa yang sudah tervalidasi sebagai blueprint**, bukan dibuang:
- Skema database MySQL (sudah matang lewat beberapa iterasi kolom).
- 11 file JSON bank skrip (`scripts-chat/`, `conversion-chat/`) — dipindah apa adanya sebagai data, bukan ditulis ulang.
- Seluruh alur kerja bisnis yang sudah dipakai CS: 8 tahap pipeline konversi, framework NPGD/MRBVA/CRA/TGJP, model multi-brand scoping, shared inbox dengan claim PIC & auto-takeover.
- Temuan audit keamanan versi PHP (lihat Bagian 6) — supaya versi baru tidak mengulang kesalahan yang sama.

Rollout dilakukan **bertahap per modul** (bukan big-bang): dimulai dari Chat/Copilot Workspace karena di situ nilai real-time paling terasa, modul lain menyusul sambil versi PHP tetap berjalan untuk modul yang belum di-cutover.

---

## 1. Executive Summary & Problem Statement

### 1.1 Background
Perusahaan mengelola **5 Brand Travel Umroh**. Dalam operasional harian, tim Customer Service internal (mis. CS Fitri dan CS Malik di Hana Tours) menangani *inbound leads* (calon jamaah) dari WhatsApp, iklan Meta Ads (*Click-to-WhatsApp*), dan formulir website resmi.

Versi PHP (`csumroh-php`) sudah berhasil membereskan masalah operasional awal — skrip agen-vs-CS, risiko salah kirim rekening antar brand, CRM terstandarisasi, integrasi Meta CAPI. Namun versi tersebut membawa keterbatasan arsitektur yang mendorong rewrite ini:

1. **Real-time semu**: chat live sebenarnya berjalan lewat polling (`setInterval` + `fetch` tiap beberapa detik), bukan push sungguhan — delay terasa dan boros request ke server.
2. **File monolitik**: `chat.php` >3.600 baris mencampur HTML, PHP, dan seluruh state Alpine.js dalam satu file — titik technical debt terbesar, makin sulit dirawat seiring fitur bertambah dan tim tumbuh.
3. **Auth berbasis session cookie PHP** — tidak bisa dipakai langsung oleh aplikasi mobile yang direncanakan; mobile app butuh token-based auth.
4. **Celah keamanan** yang ditemukan pada audit: secret (DB password, gateway secret, password demo) hardcoded langsung di source code yang repo-nya publik; tidak ada proteksi CSRF di endpoint yang mengubah data; verifikasi SSL dimatikan hardcoded pada request Meta CAPI; CORS WhatsApp gateway terbuka penuh tanpa pembatasan origin.
5. **Ketergantungan pada Baileys** (library WhatsApp Web tidak resmi) — risiko bisnis nomor WA ter-banned, dipertahankan sebagai keputusan sadar di rewrite ini (tidak ada alternatif resmi yang setara), tapi diisolasi lebih baik secara arsitektur.

### 1.2 Objective
Membangun ulang sistem operasi CS Umroh dengan arsitektur **React SPA + Node.js/TypeScript**, tanpa kehilangan satu pun kapabilitas bisnis yang sudah tervalidasi di versi PHP, ditambah:

1. **Copilot Chat & Smart Script Copier** — 19 variabel dinamis, 1-klik salin/kirim ke WhatsApp (sama seperti versi PHP).
2. **Live WhatsApp Web & Multi-CS Shared Inbox real-time** — push sungguhan lewat WebSocket, bukan polling.
3. **Enterprise CRM Pipeline 360°** — Kanban 8 tahap + Rich Table, kalkulasi kamar pax, estimasi deal value, dokumen paspor/vaksin, timeline aktivitas.
4. **Interactive TGJP Objection Wizard** — 4 langkah terpandu (Terima → Gali → Jawab → Pastikan).
5. **Meta Conversions API (CAPI) server-side** — otomatis terkirim saat status prospek berubah.
6. **LMS Belajar Mandiri** — 9 modul kurikulum konversi umroh.
7. **Super Admin Multi-Brand** — kelola brand, paket multi-kamar, akun CS.
8. **(Baru) Fondasi API siap-mobile** — REST API + WebSocket dengan auth token (JWT), dirancang supaya aplikasi React Native di masa depan bisa langsung konsumsi API yang sama tanpa backend terpisah.
9. **(Baru) Keamanan sebagai kebutuhan inti**, bukan tambahan belakangan — lihat Bagian 6.

---

## 2. Design System & Aesthetic Guidelines

Palet dan filosofi visual **dipertahankan identik** dengan versi PHP — ini bukan proyek redesign, murni migrasi arsitektur.

### 2.1 Style: Strict Neutral Monochrome
* **Palet Warna** (sama seperti versi PHP):
  * Body/Canvas: `#FFFFFF`
  * Panel/Card/Sidebar: `#FAFAFA` (zinc-50) & `#F4F4F5` (zinc-100)
  * Border & Divider: `#E4E4E7` (zinc-200) & `#D4D4D8` (zinc-300)
  * Teks Utama: `#000000` / `#18181B` (zinc-900)
  * Teks Sekunder: `#3F3F46` (zinc-700) / `#71717A` (zinc-500)
* **Buttons & Badges**: sama seperti versi PHP (Primary `bg-black text-white`, Secondary outline zinc-300, badge status semantik monokrom dengan aksen Closed Won hijau).
* **Implementasi teknis berubah**: token warna di atas didefinisikan sebagai **Tailwind config theme** (`tailwind.config.ts`) di `packages/config`, bukan lagi di-load lewat CDN, supaya konsisten dipakai lintas komponen dan bisa di-tree-shake saat build.
* **Zero Native `<select>` Policy** — **tetap berlaku**, tapi implementasinya berubah: gunakan komponen `Listbox`/`Combobox`/`DropdownMenu` dari **Radix UI** (unstyled, accessible primitives) yang di-styling dengan token monokrom di atas. Ini menggantikan pola `x-data="{ open: false }"` Alpine.js versi PHP dengan pendekatan React yang setara secara visual dan perilaku (termasuk `@click.outside` → `onPointerDownOutside` Radix).
* **Layout Rule**: tetap harus nyaman dipakai dalam mode Split-Screen (50% layar) berdampingan dengan WhatsApp Web/aplikasi lain — ini requirement UX yang tidak berubah oleh migrasi arsitektur.

---

## 3. User Personas & Roles

| Role | Tanggung Jawab Utama | Lingkup Akses |
| :--- | :--- | :--- |
| **Super Admin** | Manajemen entitas bisnis pusat & analitik | Akses lintas brand, kelola master brand & kredensial Meta, kelola master paket, manajemen akun CS, monitoring seluruh prospek & sesi WhatsApp. |
| **Customer Service (CS)** | Konsultasi jamaah, follow-up, & closing | Terisolasi pada 1 brand penugasan, kolaborasi multi-CS (*shared inbox*), klaim PIC prospek, kirim obrolan WhatsApp, akses Copilot skrip & CRM pipeline, akses LMS. |

Tidak ada perubahan role/persona dari versi PHP.

---

## 4. Functional Requirements

Seluruh REQ di bawah **dipertahankan penuh** dari versi PHP, dengan catatan implementasi baru di React/Node ditandai *(Implementasi baru: ...)* bila relevan.

### 4.1 Autentikasi & Multi-Brand Scoping
* **REQ-AUTH-01**: Login berbasis email dan password. *(Implementasi baru: JWT access token + refresh token, lihat Bagian 5.4 — menggantikan session cookie PHP.)*
* **REQ-AUTH-02**: Pemisahan hak akses strictly antara `superadmin` dan `cs`, ditegakkan di middleware backend (bukan hanya guard halaman seperti `require_role()` versi PHP) sehingga setiap endpoint API tervalidasi independen dari UI.
* **REQ-AUTH-03**: Saat CS login, seluruh variabel brand (Nama Travel, Izin PPIU, Rekening Bank) dan pilihan paket otomatis terisolasi sesuai brand CS. Diimplementasikan sebagai `brandId` yang tertanam dalam JWT claim dan divalidasi di setiap query backend (brand-scoping guard), bukan hanya filter di query builder.
* **REQ-AUTH-04 (Multi-CS Collaboration)**: Beberapa CS dapat di-assign ke brand yang sama; seluruh CS pada brand tersebut melihat prospek & percakapan brand secara transparan (*shared inbox*).

### 4.2 WhatsApp Live Chat & Shared Inbox
* **REQ-CHAT-01 (Messaging Engine)**: Kirim/terima teks, foto, dokumen PDF brosur, voice note, video, stiker, reaksi emoji, kutipan balasan (*quoted replies*).
* **REQ-CHAT-02 (Multi-Session Brand Gateway)**: Service `apps/wa-gateway` (Baileys) mengelola sesi terisolasi per brand (`sessions/brand_{id}/`).
* **REQ-CHAT-03 (Multi-Identifier Auto-Select)**: Pencocokan otomatis percakapan berdasarkan `remote_jid` (`@lid`/`@s.whatsapp.net`), `prospect_id`, atau nomor telepon saat CS membuka livechat dari tautan prospek.
* **REQ-CHAT-04 (Auto-Stub New Chat)**: Kontak baru tanpa riwayat WA otomatis mendapat *stub chat* agar CS bisa langsung mengirim pesan pembuka.
* **REQ-CHAT-05 (Split Dual Panel)**: Panel kanan berisi detail CRM prospek + drawer Copilot skrip, tanpa reload/pindah route penuh (React client-side state, bukan pindah halaman PHP).
* **REQ-CHAT-06 (CS PIC Management & Auto-Takeover)**: Tombol `[Ambil Alih]`; saat CS membalas chat, `prospects.user_id` otomatis berubah ke ID CS tersebut. *(Implementasi baru: operasi klaim/takeover wajib atomic — lihat catatan concurrency Bagian 5.5.)*
* **REQ-CHAT-07 (Deteksi Iklan Meta CTWA)**: Badge referral iklan (`Ad ID`, `Campaign ID`, pesan pembuka) pada obrolan.
* **REQ-CHAT-08 (Baru — Real-Time Push)**: Pesan masuk/keluar, perubahan status koneksi WA, dan klaim PIC didorong ke client via WebSocket dalam <2 detik, tanpa polling. Semua CS pada brand yang sama melihat update secara live tanpa refresh.

### 4.3 Enterprise CRM Pipeline & Prospek Umroh
* **REQ-CRM-01 (8 Tahapan Konversi)**: `new` → `identifying` → `offered` → `objection`/`followup` → `closing` → `closed_won`/`closed_lost` (status `nurture` dipertahankan di skema sebagai status tambahan untuk edukasi jangka panjang, lihat Bagian 5.2).
* **REQ-CRM-02 (Dual View Switcher)**: Kanban Board & Rich Table List, sama seperti versi PHP.
* **REQ-CRM-03 (Filter Toolbar)**: Search instan, Quick Filter Pills, filter Paket/Sumber Lead/Tim CS PIC.
* **REQ-CRM-04 (Klaim PIC Kolaboratif)**: Tombol `[Klaim PIC]` pada Kanban card & baris tabel untuk prospek yang belum dipegang CS yang login.

### 4.4 Profil Prospek 360°
* **REQ-DET-01 s.d. REQ-DET-06**: Kualifikasi NPGD, kalkulator kamar pax & deal value, status dokumen paspor/vaksin, rekapitulasi finansial DP, timeline log aktivitas, tab skrip TGJP inline — seluruhnya dipertahankan identik dari versi PHP.

### 4.5 Copilot Chat Workspace
* **REQ-COP-01 s.d. REQ-COP-04**: 19 variabel terinterpolasi, 1-klik salin & Quick WA, standarisasi CRO (*Single-Question Rule*), TGJP Objection Wizard 4 langkah — dipertahankan identik. Engine interpolasi variabel dipindah menjadi pure function TypeScript yang di-share via `packages/shared-types` antara backend (untuk keperluan lain) dan frontend.

### 4.6 Meta Conversions API (CAPI)
* **REQ-CAPI-01 s.d. REQ-CAPI-03**: Trigger otomatis event `Contact`/`AddToCart`/`InitiateCheckout`/`Purchase`, hashing SHA256 nomor telepon & email, audit log di `meta_capi_logs` — dipertahankan identik. *(Implementasi baru: request ke Graph API wajib memverifikasi SSL — lihat Bagian 6, tidak boleh ada `rejectUnauthorized: false` di production.)*

### 4.7 Modul E-Learning LMS Mandiri CS
* **REQ-LMS-01 s.d. REQ-LMS-03**: 9 bab materi, komparasi chat salah/benar, checklist pemahaman — dipertahankan identik. Progres checklist yang sebelumnya disimpan di local storage browser tetap boleh client-side, tapi disarankan mulai dicatat juga ke backend (per user) supaya progres belajar CS tidak hilang saat ganti device — ini nilai tambah kecil yang relevan begitu ada rencana mobile app.

### 4.8 Super Admin Management
* **REQ-ADM-01 s.d. REQ-ADM-03**: Kelola Brand, Paket Umroh, Akun CS — dipertahankan identik.

---

## 5. Technical Architecture

### 5.1 Ringkasan Stack
| Layer | Teknologi | Catatan |
| :--- | :--- | :--- |
| Frontend Web | React 18 + TypeScript + Vite | SPA, client-side routing (React Router) |
| Styling | Tailwind CSS (build via Vite, bukan CDN) | Token monokrom identik versi PHP |
| UI Primitives | Radix UI | Menegakkan Zero Native `<select>` Policy |
| Server State | TanStack Query (React Query) | Cache + invalidation dari event WebSocket |
| Client/UI State | Zustand | State ringan (drawer, active conversation, dsb) |
| Forms | React Hook Form + Zod resolver | Validasi form konsisten dengan validasi backend |
| Backend API | Node.js + TypeScript + Express | REST API, modular per domain |
| Validasi Backend | Zod | Schema sama dipakai di frontend (`packages/shared-types`) |
| ORM | Prisma | Type-safe query ke MySQL, migrasi terkelola |
| Database | MySQL 8.0 | Skema dipertahankan dari versi PHP (lihat Bagian 5.2) |
| Real-time | Socket.io | Room per `brand:{brandId}`, event-based |
| WhatsApp Gateway | Node.js + `@whiskeysockets/baileys` | Proses terpisah (`apps/wa-gateway`), tetap Baileys (tidak ada alternatif resmi setara) |
| Auth | JWT (access + refresh token) | Lihat Bagian 5.4 |
| Testing | Vitest + React Testing Library | Wajib untuk business logic kritikal, lihat Bagian 6.4 |
| Package Manager | pnpm (workspaces) | Monorepo, lihat AGENTS.md untuk struktur folder |

### 5.2 Skema Database
Skema MySQL **dipertahankan dari versi PHP tanpa perubahan struktural** (`brands`, `users`, `packages`, `prospects`, `prospect_logs`, `whatsapp_sessions`, `chat_messages`, `meta_capi_logs`) — lihat AGENTS.md untuk DDL lengkap yang dipetakan ke `schema.prisma`. Satu tabel baru ditambahkan karena kebutuhan arsitektur (bukan fitur baru):

* **`refresh_tokens`**: menyimpan hash refresh token JWT per user, untuk mendukung rotasi token, revoke saat logout, dan revoke-semua-device (relevan begitu ada mobile app). Lihat AGENTS.md Bagian 6 untuk DDL.

### 5.3 Real-Time Architecture
Menggantikan pola versi PHP (`gateway Baileys → webhook PHP → client polling`) dengan:

```
Baileys (apps/wa-gateway) ──HTTP internal──▶ API (apps/api)
                                                   │
                                                   ├─▶ simpan ke MySQL (chat_messages, prospects)
                                                   │
                                                   └─▶ broadcast via Socket.io ke room brand:{brandId}
                                                              │
                                                              ├─▶ Web client (React)
                                                              └─▶ Mobile client (masa depan)
```

Event WebSocket utama: `message:new`, `message:status`, `prospect:updated`, `prospect:claimed`, `wa:status`, `wa:qr`. Detail kontrak event ada di AGENTS.md Bagian 7.

Catatan skalabilitas: untuk single-instance API server, Socket.io tanpa adapter tambahan sudah cukup. Bila di kemudian hari API di-scale ke multi-instance, wajib menambahkan Redis adapter (`@socket.io/redis-adapter`) — dicatat sebagai future work, bukan kebutuhan v1.

### 5.4 Auth Flow
* `POST /api/v1/auth/login` → validasi email/password (bcrypt/argon2) → mengembalikan **access token** (JWT, umur pendek ~15 menit, disimpan di memory/React Query cache di client — **bukan** `localStorage`, untuk mengurangi risiko pencurian token lewat XSS) + set **refresh token** sebagai cookie `httpOnly`, `Secure`, `SameSite=Strict` (umur panjang, mis. 30 hari).
* `POST /api/v1/auth/refresh` → baca refresh token dari cookie, validasi & rotasi (refresh token lama direvoke, terbitkan baru) → access token baru.
* `POST /api/v1/auth/logout` → revoke refresh token yang aktif di `refresh_tokens`.
* Karena access token dikirim lewat header `Authorization: Bearer` (bukan cookie ambient), permukaan serangan CSRF pada endpoint API berkurang signifikan dibanding pola session-cookie PHP — tapi endpoint yang bergantung pada refresh cookie (`/auth/refresh`, `/auth/logout`) tetap wajib dilindungi `SameSite=Strict` + CORS origin allowlist ketat.

### 5.5 Concurrency: Claim PIC
`REQ-CHAT-06`/`REQ-CRM-04` (klaim PIC & auto-takeover) rawan race condition bila dua CS mengklaim prospek yang sama nyaris bersamaan. Implementasi wajib pakai **conditional update** (bukan read-then-write terpisah), contoh pola Prisma:

```ts
const claimed = await prisma.prospect.updateMany({
  where: { id: prospectId, userId: null }, // hanya berhasil kalau belum ada PIC
  data: { userId: claimingUserId },
});
if (claimed.count === 0) {
  // sudah diklaim CS lain duluan — kembalikan 409 Conflict, bukan overwrite diam-diam
}
```

### 5.6 WhatsApp Gateway
Tetap Node.js + Baileys, tapi diisolasi sebagai service terpisah (`apps/wa-gateway`) dalam monorepo yang sama (bukan repo terpisah seperti versi PHP), sehingga:
- Satu bahasa & tooling dengan `apps/api`/`apps/web` (memudahkan tim JS/TS yang akan bertambah).
- Crash pada proses Baileys tidak mematikan API utama.
- Komunikasi ke `apps/api` lewat HTTP internal (bukan lagi lewat PHP webhook), diteruskan sebagai event Socket.io ke client.

---

## 6. Non-Functional Requirements & Security (Baru — Wajib)

Bagian ini lahir langsung dari temuan audit teknis versi PHP. Setiap poin di bawah adalah **hard requirement**, bukan saran opsional.

1. **Tidak ada secret di source code.** Seluruh kredensial (DB, JWT signing key, WA gateway internal secret, Meta access token per brand) wajib lewat environment variable (`.env`, tidak pernah di-commit — sediakan `.env.example`). Secret yang sempat terekspos di repo `csumroh-php` publik wajib dirotasi, bukan dipakai ulang di sistem baru.
2. **Tidak ada `rejectUnauthorized: false` / SSL verification dimatikan** di request manapun ke API eksternal (Meta Graph API dsb.), termasuk saat development.
3. **CORS eksplisit** — origin allowlist (bukan wildcard `*`) di `apps/api` dan `apps/wa-gateway`, kredensial (`credentials: true`) hanya untuk origin yang terdaftar.
4. **Validasi input di setiap boundary API** menggunakan Zod schema (shared dengan frontend), bukan asumsi input dari client selalu benar.
5. **Query database hanya lewat Prisma** (parameterized by default) — raw SQL, kalau terpaksa dibutuhkan, wajib pakai parameter binding, tidak boleh interpolasi string.
6. **Rate limiting** pada endpoint auth (`/login`, `/refresh`) untuk mencegah brute-force.
7. **File upload (flyer paket) tetap divalidasi lewat isi file** (bukan hanya ekstensi) — pola versi PHP yang sudah benar (`getimagesize`+re-encode) dipertahankan, di Node diimplementasikan pakai library `sharp` (kebetulan sudah dipakai `wa-gateway` untuk media WA, tinggal reuse).
8. **Audit trail dipertahankan**: setiap perubahan status prospek, klaim PIC, dan pengiriman event CAPI tetap tercatat di `prospect_logs`/`meta_capi_logs`, sama seperti versi PHP.

---

## 7. Migration & Rollout Strategy

Mengacu pada keputusan yang sudah diambil bersama tim (lihat dokumen analisa terpisah `analisa-csumroh-php-react-migration.md`):

1. **Fase 0**: Tambal keamanan di `csumroh-php` yang masih operasional (env var, SSL verify, CORS) — berjalan paralel, tidak menunggu rewrite selesai.
2. **Fase 1**: Setup monorepo, skema Prisma dari DB existing, auth JWT, Socket.io skeleton.
3. **Fase 2**: Migrasi modul **Chat/Copilot Workspace** duluan (nilai real-time tertinggi) — cutover saat sudah tercapai *feature parity* dengan `chat.php`.
4. **Fase 3**: Migrasi CRM Pipeline (`prospects.php`/`prospect_detail.php`).
5. **Fase 4**: Migrasi Admin Panel & LMS.
6. **Fase 5**: Retire `csumroh-php` sepenuhnya setelah seluruh modul tercapai parity dan tervalidasi di operasional harian.

Selama transisi, `csumroh-php` dan sistem baru boleh berjalan berdampingan mengakses skema MySQL yang kompatibel — modul yang belum di-cutover tetap dilayani PHP.

---

## 8. Success Metrics & Key Results (OKRs)

1. **Real-time genuine**: latensi pesan masuk sampai muncul di layar CS < 2 detik (dari sebelumnya bergantung interval polling).
2. **Efisiensi Waktu CS**: kecepatan merespons chat meningkat 3x lipat (target dipertahankan dari versi PHP).
3. **Akurasi Bisnis Multi-Brand**: 0% kesalahan rekening/nama travel antar brand.
4. **Zero Secret Exposure**: 0 kredensial hardcoded di source code, terverifikasi lewat code review/CI secret-scanning.
5. **Kolaborasi Tim Tanpa Gesekan**: 100% prospek punya kejelasan CS PIC, klaim tanpa race condition (lihat 5.5).
6. **Kesiapan Mobile**: backend API bisa dikonsumsi aplikasi React Native tanpa perubahan kontrak, saat proyek mobile dimulai.
7. **Test Coverage Business Logic Kritikal**: pipeline status transition, TGJP wizard, kalkulator deal value, engine interpolasi skrip — tercover unit test (lihat AGENTS.md Bagian 8).
