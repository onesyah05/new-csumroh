# Audit UI/UX Pipeline dengan skill ui-ux-pro-max — 23 September 2026

**Ringkasan:** Setelah perbaikan P1–P10 hari ini, Pipeline sudah memenuhi sebagian besar aturan prioritas tertinggi skill ini: alternatif untuk drag, fokus keyboard yang terlihat, aksi tanpa hover, deep link, ikon SVG, serta informasi yang tidak bergantung pada warna saja. Sisa masalahnya terkonsentrasi di **ukuran target klik, kontras teks kecil, dan kerapian label**, ditambah satu bug tampilan: lencana keberatan menampilkan kode internal seperti `price`. Audit ini hanya membaca; tidak ada kode aplikasi yang diubah karena ada agen lain yang sedang mengedit halaman ini.

## Metode

| Langkah skill | Yang dijalankan |
| --- | --- |
| 1. Analisis | CRM internal (dashboard kerja) untuk CS/Finance travel umroh; dipakai seharian, sering split-screen ±700 px. Stack dari `package.json`: React 18 + Vite + Tailwind 3 + Radix. Gaya wajib monokrom (AGENTS §3). |
| 2. `--design-system` (pembanding, tidak dipersist) | `"internal crm sales pipeline dashboard" --variance 2 --density 8` → gaya **Minimalism & Swiss Style** untuk dashboard enterprise, sejalan dengan arah monokrom proyek. Palet biru dan font Fira **tidak** dipakai karena aturan proyek lebih tinggi. Pola "Product Demo" (landing page) tidak relevan. |
| 3. Kueri `--domain ux` | dragging movements, focus visible keyboard, touch target size, hover only interaction, text contrast small, badge chip label wraps, horizontal scroll layout, live badge count screen reader, toast auto dismiss, reduced motion, deep linking state, empty state guidance, skeleton loading. Kueri "icon button accessible label" meleset lalu diulang sekali di `--domain icons`. |
| 4. `--stack react` / `html-tailwind` | focus ring outline, truncate text overflow, context rerender memo. Kueri virtualisasi dua kali **tidak cocok di database**; aturan `virtualize-lists` diambil dari `references/quick-reference.md` dan ditandai sebagai fallback. |
| Bukti | Kode `PipelinePage.tsx` terbaru (1129 baris, termasuk `ProspectAvatar` dari agen lain), `globals.css`, `components/ui/avatar.tsx`, dan tangkapan layar pengguna (board dengan data asli). Tab otomatisasi auditor tidak memegang sesi login, sehingga tidak ada pengukuran di browser langsung. |

## Temuan (urut prioritas skill)

### U1 — Tinggi — Target klik di bawah 24 px (Target Size Minimum, WCAG 2.2 AA)

Skill: *"Use at least 24 by 24 CSS px"*. Target yang terlalu kecil:
- Tombol lipat kolom (`p-0.5` + ikon 13 px ≈ **17 px**).
- Tombol hapus pencarian (`p-0.5` + ikon 13 px ≈ 17 px).
- Tombol tutup toast (ikon 14 px tanpa padding).
- Tautan "Lompat ke …" berupa teks 12 px tanpa padding (tinggi ≈ 16 px, berjarak rapat).

Tombol aksi kartu (`p-1.5` + 14 px = 26 px) dan menu "…" (24 px) sudah lolos. **Saran:** minimal `p-1.5`/`h-6 w-6` untuk tombol ikon; tautan lompat diberi `py-1 px-1`.

### U2 — Tinggi — Kontras teks kecil (Color Contrast 4,5:1)

- "Lompat ke" dan angka di sampingnya memakai `text-zinc-400` (#a1a1aa) di atas latar abu muda: **±2,6:1** (baris 521 dan 524).
- Teks 11 px `text-zinc-500` di header kolom ("Belum ada nilai penawaran", "Potensi") duduk di atas `bg-zinc-100/70`: **±4,4:1**, tipis di bawah batas.

**Saran:** `zinc-600` untuk teks sekunder di atas latar kolom, `zinc-500` hanya di atas putih.

### U3 — Tinggi — Label ringkas: kode mentah, tidak dibatasi, teks lengkap hanya via hover

Skill *Compact Label Overflow*: label chip tetap satu baris, nilai tak terduga dibatasi, teks lengkap tersedia **bukan hanya lewat hover**.
- **Bug:** lencana keberatan menampilkan `prospect.objectionCategory` apa adanya ([PipelinePage.tsx:937](../apps/web/src/features/prospects/PipelinePage.tsx:937)), yaitu kode seperti `price`, `facility_distance`, `family_decision`. Label Indonesia sebenarnya ada di `ObjectionModal`.
- `CardBadge` tidak memakai `whitespace-nowrap`/`max-w`, sehingga label panjang bisa patah di dalam pill.
- Nama paket dan nama PIC yang terpotong hanya bisa dibaca lewat `title` (hover). Pengguna tablet/sentuh tidak bisa melihat teks lengkap.

**Saran:** pakai peta label bersama (satu sumber di shared-types); `whitespace-nowrap max-w-full truncate` pada lencana; teks lengkap tersedia di halaman detail atau menu kartu, bukan hanya `title`.

### U4 — Sedang — Teks informatif 11 px di banyak tempat

Skill (Typography): hindari teks isi di bawah 12 px. Metadata kartu, lencana, header kolom, penanda follow-up, dan label filter masih 11 px (`text-[11px]`). Di tangkapan layar, baris abu kecil ini mendominasi kartu. **Saran:** 12 px (`text-xs`) sebagai minimum untuk teks yang harus dibaca; 11 px hanya untuk angka hitungan di dalam pill.

### U5 — Sedang — Hitam penuh dipakai untuk terlalu banyak makna (visual hierarchy / state clarity)

Isian `bg-zinc-950` sekaligus berarti: chip aktif, tampilan aktif (Papan), nomor kolom (9×), lencana mendesak ("Menunggu balasan", "Follow-up lewat"), dan tombol "Klaim". Di tangkapan layar ada ±20 elemen hitam dalam satu layar, sehingga sinyal mendesak tidak menonjol lagi. **Saran:** batasi hitam penuh untuk *pilihan aktif* dan *butuh tindakan*. Nomor kolom cukup teks/outline; "Klaim" cukup tombol outline.

### U6 — Sedang — Reduced motion belum menjangkau scroll dari JavaScript

`globals.css` sudah menonaktifkan animasi dan `scroll-behavior` untuk `prefers-reduced-motion`. Namun `scrollIntoView({ behavior: 'smooth' })` (lompat ke kolom) dan `scrollBy({ behavior: 'smooth' })` (tombol geser) memakai opsi eksplisit yang tidak ikut aturan CSS itu. **Saran:** pilih `behavior` dari `matchMedia('(prefers-reduced-motion: reduce)')`.

### U7 — Sedang — Error hilang sendiri setelah 5 detik

Skill (Toast): auto-dismiss 3–5 detik hanya untuk info yang *tidak kritis*. Pesan "X tidak dipindahkan: …" dan "Klaim gagal: …" memakai toast yang sama dan ikut hilang setelah 5 detik. **Saran:** error tetap tampil sampai ditutup, idealnya juga ditandai di kartu terkait.

### U8 — Sedang — Board kosong karena filter tidak memberi jalan keluar

Skill (Empty States): tampilkan pesan dan aksi. Bila pencarian atau filter menghasilkan 0 prospek, papan menampilkan 9 kolom "Belum ada prospek" tanpa penjelasan bahwa filterlah penyebabnya dan tanpa tombol reset. Tabel menampilkan pesan, tetapi tanpa aksi. **Saran:** satu pesan di atas board, "Tidak ada prospek untuk filter ini", dengan tombol "Hapus filter".

### U9 — Sedang — Avatar baru: nama dibaca dua kali, inisial menyesatkan

`ProspectAvatar` (ditambahkan agen lain) memakai `alt={name}` padahal nama sudah tampil di sebelahnya, sehingga pembaca layar mengucapkan nama dua kali. Skill (icons): ikon/gambar dekoratif di samping teks yang setara diberi `alt=""`/`aria-hidden`. Selain itu, inisial dibuat dengan membuang karakter non-Latin, sehingga nama beraksara Arab menjadi **"PR"** dan kontak tanpa nama menjadi **"62"**.

### U10 — Sedang — Scroll horizontal di split-screen (Layout/Responsive, content-priority)

Skill menghindari scroll horizontal. Untuk Kanban 9 kolom hal itu tidak terhindarkan, dan mitigasinya sudah ada: lompat ke tahap, lipat kolom, dan tombol geser. Namun pada ±700 px (mode kerja wajib di AGENTS §3) hanya ±2 kolom yang terlihat. **Saran:** di bawah ±900 px, gunakan tampilan Tabel/daftar ringkas sebagai default (tetap bisa diganti, tersimpan di URL).

### U11 — Rendah — Kolom panjang dirender penuh (fallback: `virtualize-lists`, bukan hasil database)

Tidak ada kecocokan di database skill setelah dua kueri; aturan diambil dari `references/quick-reference.md`: *virtualize lists with 50+ items*. Saat ini setiap kolom merender semua kartu, dan setiap event realtime memicu render ulang seluruh board. Dengan 10 prospek tidak terasa, tetapi brand dengan ratusan lead akan terasa lambat. **Saran:** batasi 30 kartu per kolom plus "Tampilkan lebih banyak", atau virtualisasi per kolom.

## Yang sudah lolos aturan skill

| Aturan | Status |
| --- | --- |
| Dragging Movements (WCAG 2.2 AA) | Ada alternatif satu klik: menu "…" → "Langkah berikutnya" |
| Focus States | `button/a:focus-visible` memakai `ring-2` di `globals.css` |
| Hover vs Tap | Aksi kartu dan tabel selalu terlihat |
| Deep Linking | Tampilan, filter cepat, pencarian, paket, dan sumber tersimpan di URL |
| Color not only | Lencana mendesak dibedakan dengan isian, ikon, dan teks; kolom non-aktif dengan opasitas dan label |
| No emoji icons | Semua ikon Lucide SVG |
| Number tabular | Nilai dan jumlah memakai `tabular-nums` |
| Loading | Skeleton kolom dengan `aria-busy` |
| Reduced motion (CSS) | Aturan global `prefers-reduced-motion` ada (lihat U6 untuk celah JS) |
| Gaya | Minimal/Swiss monokrom, konsisten dengan rekomendasi design-system untuk dashboard |

## Prioritas perbaikan

1. **U3** (bug label keberatan), **U1**, dan **U2**: perubahan kecil, dampak langsung ke keterbacaan dan aksesibilitas.
2. **U9**: koordinasikan dengan agen yang menambahkan `ProspectAvatar`.
3. **U5, U4, U7, U8**: kerapian hierarki dan umpan balik.
4. **U6, U10, U11**: gerak, split-screen, dan skala.

Karena halaman ini sedang diedit agen lain, perbaikan sebaiknya dijadwalkan setelah perubahan mereka selesai agar tidak saling menimpa.

## Status perbaikan U1–U3 (23/09)

| Temuan | Status | Perubahan |
| --- | --- | --- |
| U1 target klik | Diperbaiki | Tombol hapus pencarian, lipat kolom, dan tutup toast kini 24×24 px (`h-6 w-6`); tautan "Lompat ke" dan "Reset filter" diberi padding (`min-h-6 px-1.5 py-1`). |
| U2 kontras | Diperbaiki | Tidak ada lagi `text-zinc-400` di halaman ini. Teks di atas latar abu (baris petunjuk, header kolom, kolom kosong, kepala tabel) memakai `zinc-600`. Teks kolom non-aktif saat drag tetap redup (komponen non-aktif dikecualikan WCAG). |
| U3 label | Diperbaiki | `objectionLabel()` + `objectionCategoryLabels` di shared-types (kode → label Indonesia, teks lama tetap tampil apa adanya). `CardBadge` satu baris dengan `truncate` di dalam batas kartu, ikon `aria-hidden`. Nama paket tidak lagi dipotong dengan teks lengkap hanya di hover: tampil di baris sendiri hingga 2 baris. Lebar maksimum nama PIC 180 px. |

Tes: `business.test.ts` (label keberatan) dan `PipelinePage.test.tsx` (lencana menampilkan "Harga", bukan `price`) lulus.

Catatan: `navigation.test.tsx` kini gagal karena perubahan lain di `InboxPage.tsx`. Di Inbox terbuka dialog modal "Profil dan Copilot" yang menandai sidebar navigasi `aria-hidden`, sehingga menu tidak bisa dijangkau pembaca layar maupun tes. Bukan bagian dari perbaikan U1–U3.

## Status perbaikan U4–U11 (24/09)

| Temuan | Status | Perubahan |
| --- | --- | --- |
| U4 teks 11 px | Diperbaiki | Semua teks informatif kini minimal `text-xs` (12 px). 11 px hanya tersisa di 4 angka hitungan di dalam pill (chip filter, lencana jumlah filter, jumlah per kolom). |
| U5 hierarki hitam | Diperbaiki | Nomor kolom memakai outline abu (`border-zinc-300 bg-white`). Tombol Klaim memakai outline hitam dengan tinggi minimal 24 px. Hitam penuh tersisa untuk pilihan aktif, tombol utama, dan toast. |
| U6 reduced motion (JS) | Diperbaiki | Helper `scrollMotion()` mengembalikan `auto` bila `prefers-reduced-motion: reduce`. Dipakai oleh tombol geser tepi dan "Lompat ke". |
| U7 error hilang sendiri | Diperbaiki | `toast.show(msg, { error: true })`: toast error tampil sampai ditutup, dengan `role="alert"`, latar `rose-700`, dan ikon. Info tetap hilang setelah 5 detik. Berlaku untuk gagal pindah kolom, gagal catat follow-up, dan gagal klaim. |
| U8 kosong karena filter | Diperbaiki | Bila pencarian atau filter tidak menghasilkan apa pun, muncul pesan "Tidak ada prospek yang cocok…" dengan tombol **Hapus semua filter** (menghapus `q`, `quick`, `paket`, `sumber`). Pesan kosong di tabel membedakan "tidak cocok dengan filter" dan "belum ada prospek". |
| U9 avatar | Diperbaiki | Avatar kini selalu foto profil WhatsApp, tanpa inisial. Detail di bawah. |
| U10 split-screen | Diperbaiki | Tanpa parameter `view`, layar di bawah 900 px membuka Tabel. Pilihan eksplisit tersimpan di URL (`view=kanban` atau `view=table`). |
| U11 kolom panjang | Diperbaiki | Tiap kolom Kanban merender 30 kartu, dengan tombol "Tampilkan N lainnya". Tabel merender 100 baris per halaman dengan tombol yang sama. |

Rincian U9:

- **API.** `avatar.service.ts` mengambil foto profil lewat gateway WA, lalu mengunduh dan memvalidasi gambarnya (maksimal 2 MB, harus jpg/png/webp). Foto disalin ke `/uploads/avatars/p<id>-<timestamp>-<acak>.<ext>`. URL CDN WhatsApp kedaluwarsa, jadi tidak disimpan. Salinan diperbarui setelah 7 hari, dan kontak tanpa foto tidak dicoba ulang selama 6 jam. Endpoint baru `POST /chat/avatars/refresh` menerima maksimal 40 id per brand. Daftar percakapan dan dashboard juga memperbarui avatar di latar belakang.
- **Web.** Hook `useWhatsAppAvatars` meminta refresh untuk item yang belum punya salinan lokal atau salinannya sudah kedaluwarsa, lalu memakai hasilnya saat render. `ProspectAvatar` tidak lagi memakai inisial: kontak tanpa foto, atau yang fotonya gagal dimuat, tampil dengan siluet default seperti WhatsApp. Gambar ditandai `aria-hidden` karena nama sudah tampil sebagai teks. Dipakai di Pipeline (kartu dan tabel) dan Dashboard.
- **Batasan.** Foto hanya bisa diambil saat device WhatsApp brand terhubung. Kontak yang menyembunyikan foto profilnya tetap tampil dengan siluet.

Tes baru di `PipelinePage.test.tsx` (6/6 lulus):

- avatar memakai URL foto lokal, dan kontak tanpa foto tampil dengan siluet, bukan inisial;
- banner filter kosong beserta tombol "Hapus semua filter".
