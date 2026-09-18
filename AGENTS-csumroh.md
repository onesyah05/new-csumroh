# AGENTS.md
# Guidelines & System Context for AI Coding Agents

Proyek: **CS Umroh Copilot, CRM Pipeline & WhatsApp Shared Inbox — React SPA + Node.js/TypeScript Edition**
Pendahulu: `csumroh-php` (PHP 8.3 native + Alpine.js/Tailwind CDN) — lihat `prd.md` di repo ini Bagian 0 untuk konteks lengkap migrasi.

---

## 1. Project Purpose & Scope

Rewrite arsitektur dari sistem operasional CS Umroh yang sudah tervalidasi di produksi (versi PHP) menjadi **React SPA + Node.js/TypeScript**, dengan tiga tujuan utama:
1. Real-time chat via WebSocket (bukan polling).
2. Struktur kode modular & type-safe untuk tim developer yang bertambah.
3. Fondasi API (JWT + REST + WebSocket) yang siap dikonsumsi aplikasi mobile React Native di masa depan.

**Cakupan fungsional tidak berubah** dari versi PHP: Copilot Chat 19 variabel, WhatsApp Shared Inbox multi-CS dengan claim PIC & auto-takeover, CRM Pipeline 8 tahap (Kanban + Table), Profil Prospek 360°, TGJP Objection Wizard, Meta CAPI, LMS 9 modul, Super Admin multi-brand. Detail requirement per fitur ada di `prd.md`.

---

## 2. Environment & Runtime Specifications

* **OS Development**: cross-platform (macOS/Linux/Windows via WSL2 direkomendasikan — hindari path Windows native seperti versi PHP sebelumnya).
* **Node.js**: versi `20 LTS` atau lebih baru, dipakai di seluruh layer (`apps/web` build tooling, `apps/api`, `apps/wa-gateway`).
* **Package Manager**: **pnpm** (workspaces). Jangan campur dengan `npm`/`yarn` — akan merusak lockfile monorepo.
* **Database**: MySQL 8.0 (bisa tetap pakai instance Laragon/local yang sama dengan versi PHP selama masa transisi — skema kompatibel, lihat Bagian 6). Koneksi lewat `DATABASE_URL` di `.env`, **tidak pernah** hardcode kredensial di kode (lihat Bagian 8 Rule #1).
* **WhatsApp Gateway**: `apps/wa-gateway`, Node.js + `@whiskeysockets/baileys`, port default `4001` (beda dari versi PHP yang di `3001`, untuk menghindari bentrok kalau kedua sistem jalan berdampingan saat transisi).
* **Build & Dev Tooling**:
  * `apps/web`: Vite + TypeScript + React 18.
  * `apps/api`: TypeScript, dijalankan dev via `tsx watch`, build production via `tsc`/`esbuild`.
  * **Perubahan penting dari versi PHP**: aturan lama "TIDAK MENGGUNAKAN BUILD TOOLS" **tidak berlaku lagi** di proyek ini — React SPA secara inheren butuh build step (Vite). Yang tetap dipertahankan dari filosofi lama adalah *minimalism*: jangan menambah bundler/tooling kompetitor di luar yang sudah ditetapkan di dokumen ini (mis. jangan tambah Webpack di samping Vite, jangan tambah Redux di samping Zustand+TanStack Query tanpa alasan kuat).

---

## 3. Strict Design Rules: Neutral Black & White (Monochrome)

Aturan visual **identik** dengan versi PHP — ini murni migrasi arsitektur, bukan redesign.

### Color Tokens (didefinisikan di `packages/config/tailwind-preset.ts`, extend di setiap `tailwind.config.ts` app):
* **Backgrounds**: Body `bg-white` (`#ffffff`); Panel/Card `bg-zinc-50` (`#fafafa`) / `bg-zinc-100` (`#f4f4f5`); Border `border-zinc-200` (`#e4e4e7`) / `border-zinc-300` (`#d4d4d8`).
* **Text**: Heading `text-black`/`text-zinc-900`; Body `text-zinc-700`; Subtext `text-zinc-500`.
* **Buttons & Badges**: Primary `bg-black text-white hover:bg-zinc-800`; Secondary `border border-zinc-300 text-zinc-800 hover:bg-zinc-100 bg-white`; Status badge — Closed Won `bg-emerald-600 text-white`, Progress `border border-zinc-800 bg-white text-zinc-900`, New/Pending `bg-zinc-100 text-zinc-700`, Lost `bg-zinc-200 text-zinc-600 line-through`.

### Dropdown Rule (CRITICAL — tetap berlaku):
* **DILARANG** memakai elemen `<select>` native browser di mana pun.
* Gunakan **Radix UI primitives** (`@radix-ui/react-select` untuk pengganti langsung `<select>`, `@radix-ui/react-dropdown-menu` untuk menu aksi, `@radix-ui/react-dialog` untuk modal) di-styling dengan Tailwind token di atas. Semua komponen dropdown/select wajib ditaruh di `apps/web/src/components/ui/` sebagai komponen reusable bergaya monokrom, bukan dipakai langsung sebagai raw Radix component di setiap fitur.
* Pola lama Alpine.js `x-data="{ open: false }"` + `@click.outside` digantikan otomatis oleh state internal Radix (`onOpenChange`, `onPointerDownOutside`) — jangan re-implementasi manual dengan `useState` + `useEffect` document listener kecuali Radix tidak menyediakan primitive yang sesuai.

### Layout Rule
* Seluruh halaman wajib tetap nyaman di mode **Split-Screen (~50% lebar layar)** berdampingan dengan WhatsApp Web / aplikasi lain — test manual di viewport ~700px lebar sebelum menganggap fitur selesai.

---

## 4. Multi-Brand & Multi-CS Shared Inbox Architecture

Model bisnis **dipertahankan identik** dari versi PHP:

```
[Master Brands]
       │
       ├─── [Users / CS]      (Beberapa CS bisa di-assign ke Brand yang sama)
       ├─── [Packages]        (Setiap Paket milik 1 Brand)
       ├─── [Prospects]       (Setiap Prospek milik 1 Brand, punya CS PIC = user_id)
       └─── [WA Session]      (Sesi Baileys terisolasi per brand)
```

### Aturan Scoping & Kolaborasi (ditegakkan di backend, bukan hanya UI):
1. `brandId` CS tertanam sebagai claim di JWT saat login — dipakai backend untuk memfilter setiap query, **bukan** dipercaya dari parameter request client.
2. Seluruh prospek & pesan WA satu brand terlihat oleh seluruh CS brand tersebut (*Shared Inbox / Brand Transparency*) — implementasikan sebagai Socket.io room `brand:{brandId}`, setiap koneksi client di-`join()` sesuai `brandId` dari JWT saat handshake, bukan dari input client.
3. **Klaim PIC**: `prospects.user_id`. Klaim wajib pakai conditional update (lihat `prd.md` Bagian 5.5) untuk mencegah race condition dua CS klaim bersamaan — return `409 Conflict` bila sudah diklaim CS lain.
4. **Auto-Takeover**: saat CS membalas chat WA, `prospects.user_id` otomatis di-update ke CS pengirim, lalu broadcast event `prospect:claimed` ke room brand terkait supaya UI CS lain langsung update tanpa refresh.
5. **Balanced Distribution**: kontak baru dari webhook WA dialokasikan ke CS aktif brand terkait dengan beban prospek aktif paling sedikit — logic ini murni backend (`apps/api/src/modules/prospects/distribution.ts`), tidak boleh ada logic distribusi di frontend.
6. **Keamanan Finansial**: variabel `{{travel}}`, `{{ppiu}}`, `{{rekening}}`, `{{nama_rekening}}` selalu diresolve backend dari `brandId` milik JWT CS yang login, tidak pernah dikirim dari client sebagai raw value yang bisa dimanipulasi.
7. Super Admin (`role: superadmin`) punya akses lintas brand — middleware auth wajib cek role ini secara eksplisit di setiap endpoint admin, bukan asumsi dari absennya `brandId`.

---

## 5. Standarisasi Script: Transformasi POV Agent → CS Umroh

**Aturan ini tidak berubah** dari versi PHP. File JSON asli di `packages/scripts-data/scripts-chat/` dan `packages/scripts-data/conversion-chat/` (dipindah apa adanya dari `csumroh-php`, tidak boleh dihapus/dirusak) ditulis dengan sudut pandang Agen/Mitra Lapangan. Saat menyajikan skrip ke UI:

1. **Variabel Nama**: `{{agent_name}}` → **`{{cs_name}}`**.
2. **Representasi Diri**: hapus *"mitra agen konsultan"*, *"agen resmi"*, *"referral link agen"* → ganti *"Customer Service resmi {{travel}}"* / *"tim layanan jamaah {{travel}}"* / *"konsultan umroh resmi {{travel}}"*.
3. **Inbound Context**: sesuaikan konteks pembuka untuk jamaah dari website/iklan/media sosial resmi travel.

Engine transformasi & interpolasi 19 variabel diimplementasikan sebagai **pure function TypeScript** di `packages/shared-types/src/scripts/interpolate.ts`, dipakai oleh `apps/api` (untuk endpoint `/api/v1/scripts`) dan bisa direuse langsung oleh `apps/web` untuk preview real-time tanpa round-trip ke server. Fungsi ini **wajib** punya unit test (lihat Bagian 8, Rule #6).

---

## 6. Database Schema Definition (MySQL via Prisma)

Skema **dipertahankan dari versi PHP** — mapping 1:1 ke `apps/api/prisma/schema.prisma`. DDL referensi (identik `csumroh-php`, kolom lengkap termasuk hasil migrasi bertahap seperti `pax_quad/triple/double/infant`, `passport_status`, `deal_value`, dsb — lihat repo lama untuk daftar kolom lengkap per tabel):

```sql
-- Tabel inti dipertahankan identik: brands, users, packages, prospects,
-- prospect_logs, whatsapp_sessions, chat_messages, meta_capi_logs
-- (DDL lengkap: lihat AGENTS.md versi csumroh-php, Bagian 6 — tidak diulang di sini
--  supaya dokumen ini tidak jadi sumber kebenaran ganda; schema.prisma adalah
--  source of truth teknis begitu migrasi Fase 1 selesai)

-- SATU TABEL BARU — kebutuhan arsitektur JWT, bukan fitur bisnis baru:
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,      -- hash refresh token, JANGAN simpan token mentah
    user_agent VARCHAR(255) NULL,
    ip_address VARCHAR(45) NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    KEY idx_user_active (user_id, revoked_at)
) ENGINE=InnoDB;
```

**Catatan status `nurture`**: enum `prospects.status` versi PHP terakhir memuat 9 nilai termasuk `nurture`, sementara `prd.md` versi terbaru mendeskripsikan pipeline utama sebagai 8 tahap (tanpa `nurture` di board Kanban utama). Pertahankan `nurture` di enum database untuk kompatibilitas data lama, tapi board Kanban default menampilkan 8 kolom sesuai `prd.md` — `nurture` bisa jadi status tersembunyi/filter tambahan, bukan kolom utama. **Jangan hapus nilai enum ini tanpa instruksi eksplisit dari user** (ada kemungkinan data historis memakainya).

---

## 7. Folder & Code Organization (Monorepo)

```
csumroh-react/
├── apps/
│   ├── web/                       # React SPA
│   │   ├── src/
│   │   │   ├── app/                # App shell, router, providers (QueryClient, SocketProvider, AuthProvider)
│   │   │   ├── features/           # Satu folder per domain fitur
│   │   │   │   ├── auth/
│   │   │   │   ├── chat/           # Livechat + shared inbox + copilot drawer
│   │   │   │   ├── prospects/      # CRM Kanban & Table
│   │   │   │   ├── prospect-detail/
│   │   │   │   ├── admin/
│   │   │   │   └── lms/
│   │   │   ├── components/ui/      # Design system reusable (button, dropdown, dialog, badge — Radix + Tailwind)
│   │   │   ├── lib/                # apiClient.ts, socketClient.ts, queryClient.ts
│   │   │   └── styles/
│   │   └── vite.config.ts
│   ├── api/                       # REST API + WebSocket backend
│   │   ├── src/
│   │   │   ├── modules/            # Satu folder per domain: auth, brands, packages, prospects, chat, scripts, capi, admin
│   │   │   │   └── <module>/
│   │   │   │       ├── <module>.routes.ts
│   │   │   │       ├── <module>.service.ts
│   │   │   │       └── <module>.schema.ts   # Zod schema request/response
│   │   │   ├── realtime/           # Socket.io server setup, event handlers, room join logic
│   │   │   ├── middleware/         # authGuard, brandScopeGuard, errorHandler, rateLimiter
│   │   │   ├── db/                 # Prisma client singleton, seed.ts
│   │   │   └── server.ts
│   │   └── prisma/schema.prisma
│   └── wa-gateway/                # Baileys microservice, proses terpisah
│       └── src/
│           ├── sessions/           # Multi-brand session manager
│           └── server.ts
├── packages/
│   ├── shared-types/               # Tipe TS + Zod schema kontrak API, dipakai web+api+wa-gateway
│   ├── scripts-data/               # 11 file JSON bank skrip (dipindah apa adanya dari csumroh-php)
│   └── config/                     # ESLint, Prettier, tsconfig base, Tailwind preset — dipakai bersama
├── pnpm-workspace.yaml
├── AGENTS.md                       # Dokumen ini
├── prd.md
└── README.md
```

---

## 8. Development Rules for AI Agents

1. **NO COMMIT OR PUSH WITHOUT EXPLICIT USER INSTRUCTION** (aturan mutlak, dipertahankan dari versi PHP): jangan `git commit`/`git push` kecuali pengguna eksplisit memerintahkan.
2. **ZERO NATIVE `<select>` DROPDOWNS**: gunakan komponen di `components/ui/` berbasis Radix (lihat Bagian 3).
3. **Explicit User Instruction Rule**: jangan menambah fitur/kode di luar yang diminta pengguna secara spesifik.
4. **No Secrets in Code (BARU — WAJIB, hasil audit versi PHP)**: seluruh kredensial (DB, JWT secret, WA gateway internal secret, Meta token) lewat `.env`, sediakan `.env.example` tanpa nilai asli, jangan pernah commit `.env`. Kalau menemukan secret hardcoded di kode yang sedang dikerjakan, **hentikan dan tanyakan ke user** alih-alih melanjutkan pattern tersebut.
5. **Prepared/Parameterized Queries Only**: seluruh akses database lewat Prisma. Kalau raw SQL benar-benar dibutuhkan, wajib pakai `Prisma.sql`/parameter binding — tidak boleh interpolasi string ke query.
6. **Unit Test Wajib untuk Business Logic Kritikal**: setiap kali mengimplementasi/mengubah salah satu dari — transisi status pipeline (8 tahap), state machine TGJP wizard, kalkulator deal value (pax × harga kamar), engine interpolasi 19 variabel skrip, atau payload builder Meta CAPI — sertakan/update unit test Vitest di file yang sama levelnya. Ini area yang paling sering jadi sumber bug bisnis, dan tim yang bertambah butuh regression safety net yang versi PHP single-developer tidak punya.
7. **Concurrency-Safe Claim PIC**: implementasi klaim/takeover prospek wajib pakai conditional update (lihat Bagian 4 poin 3), bukan read-then-write terpisah.
8. **Preserve Native JSONs**: file asli di `packages/scripts-data/` tidak boleh dihapus/dirusak; baca & transformasikan secara dinamis di runtime, jangan hardcode hasil transformasi.
9. **Strict Monochrome**: pertahankan palet hitam-putih-abu-abu netral di seluruh komponen UI baru (lihat Bagian 3).
10. **CORS & Auth Boundary**: jangan pernah menambahkan `origin: '*'` di konfigurasi CORS `apps/api`/`apps/wa-gateway`, dan jangan menyimpan access token JWT di `localStorage` di kode frontend manapun (lihat `prd.md` Bagian 5.4 untuk pola yang benar).
11. **Minimalism First**: kode bersih, mudah dipahami, tanpa abstraksi berlebihan. Build tooling sudah ditetapkan di dokumen ini (Vite, Express, Prisma, Socket.io, TanStack Query, Zustand, Radix) — jangan memperkenalkan library kompetitor (state manager lain, ORM lain, UI kit lain) tanpa instruksi eksplisit dari user.
