# Mobile CRM Azhan

Berlaku di bawah 768 px. Tujuan: terasa seperti aplikasi, bukan situs atau artikel. Revisi 8 Oktober 2026. MASTER.md tetap dasar: monokrom, ikon Lucide, primitive bersama. Hasil pencarian design-system yang berorientasi landing page dan palet biru tidak diterapkan.

## Prinsip

1. Aplikasi, bukan dokumen: label dan satu frasa pendek. Tanpa kalimat bantu di bawah isian, tanpa subjudul penjelas, keadaan kosong satu baris, notifikasi satu kalimat.
2. Ukuran dari komponen dan token, bukan dari lantai `min-height` global.
3. Satu pola per jenis layar; elemen sejenis berukuran sama di semua halaman.
4. Info sekunder disembunyikan di mobile (`hidden sm:block`), bukan dipadatkan.

## Token ukuran kontrol

Didefinisikan di `:root` pada `apps/web/src/styles/globals.css`; di bawah 768 px nilainya ditimpa.

| Token | Desktop | Mobile |
|-------|---------|--------|
| `--ctl-sm` | 32 | 34 |
| `--ctl-md` | 36 | 40 |
| `--ctl-lg` | 40 | 42 |
| `--ctl-icon` | 36 | 36 |
| `--ctl-field` | 36 | 40 |

- `Button` memakai `min-h-[var(--ctl-*)]` sesuai ukurannya. Hanya `input`, `[role=combobox]`, dan `[role=menuitem|option]` yang diberi `min-height: var(--ctl-field)` secara global.
- Tombol mentah (bukan `Button`) memakai tinggi alaminya. Butuh target lebih besar: `max-md:min-h-9` atau ukuran ikon eksplisit di tempatnya. Jangan menambah lantai global.
- `.segmented`: bingkai setinggi `--ctl-field`, tombol di dalam `--ctl-field` dikurangi 6 px. `.mobile-compact-control` 34 px; `.quick-reply-chip` 32 px; jarak antar chip 8 px.
- Toggle (24 px) dan checkbox kecil memperluas area sentuh lewat `::after`, bukan tinggi.
- Font isian 16 px hanya di iOS Safari (mencegah zoom saat fokus). Safe-area dipakai pada header, navigasi, panel, composer. VisualViewport menyesuaikan tinggi aplikasi tanpa merusak pinch zoom.

## Navigasi

- Navigasi bawah: Beranda, Inbox, Prospek, Lainnya. Finance: Verifikasi sebagai tujuan ketiga. Tim LA: Layanan, Notifikasi, Lainnya.
- Desktop memakai sidebar. Tablet tetap punya menu samping dan Inbox dua kolom.
- Halaman anak (Tambah Paket, Detail Brand, Profil Prospek, ...) memakai app bar "← Judul" dari breadcrumb. Tidak ada judul atau subjudul yang mengulang di isi; tombol kembali `PageHeader` disembunyikan.
- Halaman daftar: `PageHeader` dan `StatGrid` disembunyikan (`hidden md:flex` / `hidden md:grid`); baris pencarian + tombol ikon "+" menggantikan tombol tambah.

## Pola layar

- Daftar: baris (`ul md:hidden`) dengan avatar/lencana di kiri, judul, satu baris meta terpotong, aksi `⋮` atau panah di kanan. Tabel hanya untuk md ke atas (`hidden md:block`).
- Kartu: padding horizontal 16 px (20 px mulai sm); batang progres 8 px, seragam dalam satu halaman. Funnel: label + angka satu baris, batang penuh lebar di bawahnya.
- Filter: grid 2 kolom; segmented selebar penuh atau bisa digeser. Filter sekunder di panel Filter.
- Form: satu kolom untuk isian berlabel panjang; dua kolom hanya untuk pasangan pendek. Dropdown tampil sama dengan isian (tanpa bayangan). Dialog singkat menjadi panel bawah; form panjang menjadi layar penuh.
- Toast: kiri/kanan 16 px, di atas agar tidak menutup composer/navigasi; satu baris 57 px. Pesan berawalan "Gagal" tampil sebagai error.
- Tab Perangkat WhatsApp: dua kartu info (Nomor, Terakhir aktif), tombol 2 kolom dengan tombol utama selebar penuh; panduan dan keterangan Baileys hanya di desktop.
- Pipeline: pilihan Papan/Tabel; Tabel bawaan di bawah 900 px bila URL tidak menentukan tampilan.

## Percakapan (Inbox)

- Navigasi bawah disembunyikan. Header putih dua baris, minimal 64 px, padding vertikal 10 px: nama prospek (`text-sm leading-tight`) dan penanda PIC berikon di kanan; baris kedua (`text-xs leading-4`) berisi kode brand dan titik status. PIC tampil sebagai nama atau "Tanpa PIC" (amber); nama panjang dielipsis, lengkap di Profil. Nama brand penuh ada di label aksesibel/tooltip.
- Profil/Copilot selebar layar dengan tombol kembali; panel dan percakapan mengikuti URL/history. Pergantian tab internal tidak menambah langkah Back.
- Enter di keyboard mobile membuat baris baru; kirim lewat tombol Kirim.
- Draft teks/caption disimpan di sessionStorage per staf/brand/prospek, dihapus saat logout. Lampiran dan rekaman tidak dipersistenkan. Filter, pencarian, dan posisi daftar dipulihkan pada sesi tab yang sama.

## Peran dan PWA

- Ringkasan CS memprioritaskan tugas. Holding mendapat ringkasan lintas brand serta kartu brand/CS. Finance memverifikasi pembayaran (DP atau lunas).
- PWA standalone: manifest dan ikon AZ sesuai wordmark sidebar. Service worker produksi hanya menyimpan halaman bantuan offline publik, tanpa cache API, percakapan, lampiran, atau halaman autentikasi. Tidak ada antrean transaksi offline.

## Validasi minimum

360/375/430 px, split-screen 700 px, desktop, landscape, teks diperbesar, reduced motion, Back/Forward, draft lintas percakapan/halaman, role CS/Finance/Tim LA, manifest dan offline fallback. Ukur semua kontrol sejenis, bukan satu sampel. Pemeriksaan browser tidak menggantikan pengujian keyboard dan instalasi di perangkat Android/iPhone fisik.
