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

### A. Tombol (`Button`)
- **Tinggi Default**: `size="md"` (36px / `h-9`), padding `px-3.5`, font `text-xs font-semibold`, radius `rounded-xl`.
- **Tinggi Kecil**: `size="sm"` (32px / `h-8`), padding `px-2.5`, font `text-xs`, radius `rounded-lg`.
- **Tinggi Besar**: `size="lg"` (40px / `h-10`), padding `px-4`, font `text-sm`, radius `rounded-xl`.
- **Tombol Ikon**: `size="icon"` (36×36px / `h-9 w-9`), radius `rounded-xl`.
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
- **Tinggi**: `h-9` (36px).
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
- **Padat, ringkas, profesional, to-the-point.**
- Dilarang membuat caption *storytelling* atau kalimat panjang di bawah setiap judul field jika maknanya sudah jelas dari label.
- Contoh yang dilarang: *"Rincian benefit yang sudah termasuk dan yang belum termasuk dalam paket perjalanan umroh ini."*
- Contoh yang benar: *"Fasilitas Paket"* atau *"Termasuk (Include)"*.
