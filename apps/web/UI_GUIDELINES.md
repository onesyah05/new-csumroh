# UI & Design System Guidelines — CS Umroh

Dokumen ini adalah **aturan baku (Single Source of Truth)** untuk arsitektur UI/UX di seluruh aplikasi CRM CS Umroh.
Semua halaman dan fitur baru **wajib menggunakan komponen primitives** berikut, bukan menulis tag HTML mentah dengan deretan utility class Tailwind ad-hoc.

---

## 1. Komponen Primitives Utama

Semua komponen terletak di `@/components/ui/` dan siap pakai:

| Komponen | Berkas | Deskripsi & Penggunaan |
|---|---|---|
| `<PageHeader>` | `src/components/ui/page-header.tsx` | Header standar halaman (`kicker`, `title`, `badges`, `subtitle`, `backUrl` / `onBack`, `actions`) |
| `<Button>` | `src/components/ui/button.tsx` | Tombol standar (`variant="primary\|secondary\|outline\|ghost\|danger\|success"`, `size="sm\|md\|lg\|icon"`, `loading`, `icon`) |
| `<Card>` | `src/components/ui/card.tsx` | Kontainer kartu SaaS standar (`<Card>`, `<CardHeader>`, `<CardContent>`, `<CardFooter>`) |
| `<StatGrid>` & `<StatCard>` | `src/components/ui/stat-card.tsx` | Grid metrik KPI 4-kolom standar (`label`, `value`, `note`, `icon`, `valueColor`) |
| `<Select>` | `src/components/ui/select.tsx` | Custom dropdown Radix UI (`options`, `value`, `onValueChange`, `placeholder`) |
| `<StatusBadge>` | `src/components/ui/status-badge.tsx` | Badge status seragam (`status="active\|archived\|promo\|warning\|danger\|info\|neutral"`, `dot`) |

---

## 2. Standar Desain & Ukuran Token

### Token ukuran kontrol
Tinggi kontrol berasal dari token CSS `--ctl-*` di `src/styles/globals.css` (di bawah 768 px nilainya ditimpa). Jangan menulis tinggi manual (`h-9`, `min-h-11`) pada kontrol; pakai komponen atau token.

| Token | Desktop | Mobile |
|---|---|---|
| `--ctl-sm` | 32 | 34 |
| `--ctl-md` | 36 | 40 |
| `--ctl-lg` | 40 | 42 |
| `--ctl-icon` | 36 | 36 |
| `--ctl-field` | 36 | 40 |

Tidak ada lantai `min-height` global untuk `<button>`. Hanya `input`, `[role=combobox]`, dan `[role=menuitem|option]` yang memakai `--ctl-field` secara global. Detail pola mobile: `design-system/crm-azhan/pages/mobile.md`.

### A. Tombol (`Button`)
- **Default**: `size="md"` (`--ctl-md`), padding `px-3.5`, font `text-xs font-semibold`, radius `rounded-xl`.
- **Kecil**: `size="sm"` (`--ctl-sm`), padding `px-2.5`, font `text-xs`, radius `rounded-lg`.
- **Besar**: `size="lg"` (`--ctl-lg`), padding `px-4`, font `text-sm`, radius `rounded-xl`.
- **Ikon**: `size="icon"` (`--ctl-icon`, persegi), radius `rounded-xl`. Wajib `aria-label`.
- Tombol mentah yang perlu target sentuh lebih besar: `max-md:min-h-9`, bukan lantai global.
- **Varian**:
  - `primary`: Background hitam (`bg-zinc-950 text-white hover:bg-zinc-800`).
  - `secondary`: Putih border abu-abu (`border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50`).
  - `ghost`: Transparan (`text-zinc-600 hover:bg-zinc-100`).
  - `danger`: Aksi destruktif / hapus (`border-rose-200 bg-white text-rose-600 hover:bg-rose-50`).

### B. Kartu (`Card`)
- **Radius**: Wajib `rounded-xl` (12px). Dilarang memakai `rounded-3xl` atau `rounded-none`.
- **Border**: Wajib `border border-zinc-200/90`.
- **Background**: `bg-white`.
- **Padding**: Default `p-4 sm:p-5`.
- **Header Kartu (`CardHeader`)**: Judul wajib menggunakan `text-xs font-extrabold uppercase tracking-wider text-zinc-700`.

### C. Metrik KPI (`StatCard`)
- **Layout**: Wajib dibungkus dengan `<StatGrid cols={4}>`.
- **Label**: `text-xs font-medium text-zinc-500`.
- **Nilai**: `font-sans text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl tabular-nums`.
- **Catatan Sub**: `text-xs text-zinc-400`.

### D. Input Formulir
- **Tinggi**: `--ctl-field` (36 desktop, 40 mobile), diatur global; jangan override.
- **Radius**: `rounded-lg` (8px).
- **Border**: `border-zinc-200 focus:border-zinc-950 focus:outline-none`.
- **Dropdown**: Wajib menggunakan `<Select>` dari `@/components/ui/select`. Dilarang memakai `<select>` bawaan browser.
- **Durasi / Angka**: Wajib `type="number" min="1"` dengan sanitasi angka `.replace(/\D/g, '')`.

### E. Tabel Data Grid (Aturan Baku)
- **DILARANG membungkus tabel data dengan `<Card>`!**
- Tabel data grid adalah komponen level-halaman independen, bukan kartu konten.
- Gunakan kontainer tabel standar: `<div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">`.
- Header tabel: `bg-zinc-50/75 border-b border-zinc-200 text-[11px] font-semibold uppercase tracking-wider text-zinc-500`.
- Baris tabel: `divide-y divide-zinc-100 hover:bg-zinc-50/60`.
- Pagination / Footer: `border-t border-zinc-200 bg-zinc-50/50 px-4 py-3`.

### F. Proporsionalitas Penggunaan `<Card>`
- **Gunakan `<Card>` secara proporsional dan hemat**:
  - **Dilarang Card di dalam Card (nested card boxes)**. Gunakan grid tipografi bersih (`label` abu-abu + `value` teks tebal) sebagai gantinya.
  - Pada formulir satu halaman, gunakan **1 Card utama** yang menampung seluruh field dengan pembatas section halus (`border-t border-zinc-100 pt-6`). Jangan memecah form menjadi 4-5 card terpisah yang mengambang.
  - Pada halaman detail, gunakan layout 2 kolom proporsional (maksimal 2 Card pada kolom utama dan 2-3 Card di sidebar).

---

## 3. Aturan UX Copy
- **Ini aplikasi, bukan artikel panduan.** Label dan satu frasa pendek.
- Tanpa kalimat bantu di bawah isian dan tanpa subjudul penjelas; di mobile sembunyikan teks sekunder (`hidden sm:block`).
- Keadaan kosong satu baris. Notifikasi dan toast satu kalimat, tanpa penjelasan.
- **Padat, ringkas, profesional, to-the-point.**
- Dilarang membuat caption *storytelling* atau kalimat panjang di bawah setiap judul field jika maknanya sudah jelas dari label.
- Contoh yang dilarang: *"Rincian benefit yang sudah termasuk dan yang belum termasuk dalam paket perjalanan umroh ini."*
- Contoh yang benar: *"Fasilitas Paket"* atau *"Termasuk (Include)"*.

---

## 4. Mobile (< 768 px)
- Tampilan harus seperti aplikasi mobile: app bar "← Judul" untuk halaman anak, `PageHeader` dan `StatGrid` disembunyikan di halaman daftar (`hidden md:flex` / `hidden md:grid`), baris pencarian + tombol ikon "+".
- Daftar berupa baris (`ul md:hidden`), tabel hanya md ke atas (`hidden md:block`).
- Padding horizontal kartu 16 px; batang progres 8 px; seragam dalam satu halaman.
- Satu baris filter; filter sekunder masuk dropdown atau panel Filter, tidak bertumpuk.
- Verifikasi: ukur semua kontrol sejenis di lebar 375, bukan satu sampel.
