# Design System Master — CRM Azhan

> **Cara pakai:** saat membangun halaman, cek dulu `design-system/crm-azhan/pages/[halaman].md`. Bila ada, aturannya
> **menimpa** file ini; bila tidak, ikuti file ini. Aturan proyek di `AGENTS-csumroh.md` §3 tetap berlaku dan didahulukan.

**Sumber:** skill ui-ux-pro-max `--design-system "CRM sales pipeline internal tool"` (25/09/2026). Hasilnya **disesuaikan**
dengan aturan monokrom proyek:
- palet biru dan font Poppins/Open Sans dari skill tidak dipakai;
- pola halaman *landing page* dari skill tidak berlaku, karena ini aplikasi internal;
- animasi *scroll reveal* GSAP dari skill tidak berlaku.

**Kategori:** CRM & manajemen klien · **Gaya:** Minimalism & Swiss · **Dials:** Variance 3 (minimal) · Motion 2 (halus) · Density 8 (padat/dasbor)

---

## Warna (monokrom + semantik)

Kelas Tailwind yang dipakai kode saat ini. `design-rules.test.ts` menolak warna di luar daftar ini, kecuali di Inbox, yang bergaya WhatsApp atas keputusan user.

| Peran | Kelas | Catatan |
|---|---|---|
| Latar halaman | `bg-zinc-50` | |
| Permukaan (kartu/panel) | `.surface` / `bg-white` + `border-zinc-200` | |
| Teks utama | `text-zinc-950` / `text-zinc-900` | |
| Teks sekunder | `text-zinc-600` | ≥ 4.5:1 di atas putih |
| Teks bantu / placeholder | `text-zinc-500` | Batas bawah untuk teks di latar terang. `zinc-400` hanya untuk ikon dekoratif atau di latar gelap |
| Aksi utama | `bg-zinc-950 text-white` | Satu aksi utama per layar/panel |
| Fokus | ring hitam 2 px (`:focus-visible` global di `globals.css`) | Jangan `outline-none` tanpa pengganti; item menu Radix memakai `data-[highlighted]` |
| Sukses / Deal | `emerald-*` | Selalu dengan teks atau ikon, tidak warna saja |
| Peringatan | `amber-*` | Teks `amber-800/900` |
| Mendesak / galat | `rose-*` | Teks `rose-700` |

## Tipografi

- Font proyek (tidak diganti): **Geist** (UI), **Inter**, **Plus Jakarta Sans** (display), **Geist Mono** (angka/kode bila perlu).
- Skala: 12 (`text-xs`) · 14 (`text-sm`) · 16 · 20 · 24–30 (angka KPI). **Minimal 12 px**; 11 px hanya untuk angka di lencana hitungan.
- Label memakai **huruf kalimat** (`text-xs font-semibold text-zinc-600`). Huruf kapital + tracking hanya untuk label seksi sidebar dan wordmark login.
- Angka (uang, hitungan, tabel) memakai `tabular-nums`. Uang ringkas memakai `Intl` `notation: 'compact'` (mis. "Rp 27,5 jt"), dengan nilai penuh di `title`.

## Spasi dan kepadatan (density 8)

Skala 4 px: `gap-1`…`gap-6`, padding panel `p-3`–`p-5`. Panel profil Inbox (±340 px) memakai grid 2 kolom untuk pilihan dan 4 kolom untuk angka jamaah.

## Komponen

Semua komponen dasar ada di `apps/web/src/components/ui/`:
- **Button** (`button.tsx`) memakai varian yang ada; loading ditandai spinner dan tombol nonaktif.
- **Select** (`select.tsx`, Radix). **Tidak ada `<select>` native.**
- **Modal** (`modal.tsx`) untuk dialog baru; `ConfirmDialog` menggantikan `confirm()`.
- **Kartu KPI:** satu `.surface` dengan sel dipisah `gap-px bg-zinc-100` (lihat Ringkasan).
- **Status:** lencana dari `StatusBadge`/`Badge`. Status tidak disampaikan dengan warna saja.
- **Ikon:** hanya **Lucide**. Ikon dekoratif di samping teks diberi `aria-hidden`; tombol ikon diberi `aria-label`.

## Interaksi

- Target klik minimal **24×24 px** (WCAG 2.2 AA); di panel profil, pointer kasar dinaikkan ke 44 px (`@media (pointer: coarse)`).
- Info yang dibutuhkan untuk bertindak (alasan tombol nonaktif, isian yang kurang) **tampil sebagai teks singkat**. Tooltip `title` hanya pelengkap.
- Nama panjang (paket umroh) dibungkus dengan `line-clamp-2`, bukan dipotong satu baris.
- Transisi 150–250 ms; `prefers-reduced-motion` dimatikan secara global. Tidak ada animasi gulir atau dekoratif.

## Anti-pola (jangan dipakai)

- Emoji sebagai ikon UI. Emoji dalam **naskah pesan WhatsApp** adalah konten, jadi boleh.
- Gradien, bayangan kompleks, efek 3D.
- Teks < 12 px, teks abu-abu pucat (`zinc-400`) di latar terang.
- Informasi hanya lewat warna atau hanya lewat hover.
- Beberapa aksi utama berwarna hitam dalam satu panel.

## Daftar periksa sebelum rilis

- [ ] Tidak ada emoji sebagai ikon; semua ikon Lucide.
- [ ] Kontras teks ≥ 4.5:1; teks ≥ 12 px.
- [ ] Fokus keyboard terlihat di semua kontrol (termasuk item menu).
- [ ] Target klik ≥ 24 px.
- [ ] Makna tidak hanya dari warna atau hover.
- [ ] Tidak ada gulir horizontal di 375 px dan di panel profil ±340 px.
- [ ] `design-rules.test.ts` lulus.
