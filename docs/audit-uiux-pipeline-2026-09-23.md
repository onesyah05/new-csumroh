# Audit UI/UX — Pipeline (`/pipeline`) — 23 September 2026

**Ringkasan:** Pipeline sudah punya fondasi yang benar (board + tabel, antrean follow-up, aksi terpandu per tahap, menu alternatif selain drag). Masalah utamanya ada di **kepadatan dan keterlihatan**: aksi kartu tersembunyi sampai kursor diarahkan, kartu boros ruang sehingga hanya ±2 prospek per kolom terlihat, dan setengah board berada di luar layar tanpa petunjuk. Drag-and-drop juga menjanjikan "pindah bebas", padahal sebagian besar kolom menolak atau membuka form. Ada dua bug fungsional: filter paket/sumber diabaikan saat chip cepat aktif, dan klaim PIC gagal tanpa pesan.

## Metode dan batas

| Sumber | Cakupan |
| --- | --- |
| Tampilan nyata (Chrome pengguna, login superadmin, brand Hana, 1463×679) | Board dengan data asli: 9 kolom, kartu, header, chip filter |
| Kode `apps/web/src/features/prospects/PipelinePage.tsx` (989 baris) | Kartu, kolom, drag-drop, menu, tabel, dialog, filter |
| Pengukuran | Waktu API `/prospects` 147 ms dan `/catalog/packages` 24 ms; kontras warna teks |

Tidak diuji langsung: interaksi menu/modal, tampilan 700 px dan ponsel dengan data login. Tab audit kedua terbuka dalam keadaan logout dan auditor tidak memasukkan kata sandi. Temuan di area itu berasal dari kode dan ditandai *(kode)*.

Tingkat: **Tinggi** = menghambat kerja harian atau menyesatkan; **Sedang** = memperlambat atau membingungkan; **Rendah** = kerapian/konsistensi.

## Temuan

### P1 — Tinggi — Aksi kartu dan tabel hanya muncul saat hover

Tombol **Chat / Follow-up / Profil** di kartu ([PipelinePage.tsx:794](../apps/web/src/features/prospects/PipelinePage.tsx:794)) dan aksi baris tabel ([:529](../apps/web/src/features/prospects/PipelinePage.tsx:529)) memakai `opacity-0 group-hover:opacity-100`.
- Di layar sentuh (tablet/ponsel CS) tombol tidak pernah terlihat.
- Pengguna keyboard men-tab ke tombol yang tak terlihat (tidak ada `focus-within`).
- Ruangnya tetap terpakai walau tak terlihat: di tangkapan layar, sepertiga bawah setiap kartu tampak kosong.

**Saran:** tampilkan aksi utama permanen dalam bentuk ringkas (ikon berlabel, satu baris), atau cukup satu tombol "Chat" plus menu "…". Minimal tambahkan `group-focus-within:opacity-100` dan tampilkan permanen di perangkat sentuh.

### P2 — Tinggi — Board boros ruang: ±2 kartu per kolom, 4½ dari 9 kolom terlihat

- Kartu setinggi ±205 px. Isinya: baris lencana yang sering kosong, garis pemisah, paket, nilai, baris aksi tersembunyi, dan tanggal follow-up. Pada viewport 679 px hanya kartu pertama yang utuh terlihat.
- 9 kolom × 278 px ≈ 2.600 px. Di 1463 px, kolom *Keberatan, Follow-up, Closing, Deal, Batal* berada di luar layar. Tidak ada bayangan tepi, panah, atau ringkasan jumlah per tahap yang menandakan ada kolom lain.
- Header kolom tidak *sticky* dan kolom tidak menggulir sendiri. Menggulir ke bawah di kolom panjang membuat judul kolom hilang dan semua kolom ikut memanjang.
- Pada mode split-screen ±700 px yang diwajibkan AGENTS §3 *(kode)*, hanya ±2 kolom terlihat.

**Saran:** mode kartu ringkas (nama, nilai/paket, PIC, satu indikator; ±88 px). Kolom dengan tinggi tetap dan scroll internal. Header kolom sticky. Strip ringkasan tahap di atas board (jumlah + nilai, klik untuk lompat ke kolom). Opsi melipat kolom Batal/Deal.

### P3 — Tinggi — Drag-and-drop menjanjikan pindah bebas, tetapi kebanyakan kolom menolak atau membuka form

Petunjuk di layar berbunyi "Tarik kartu ke kolom tujuan untuk mengubah status" ([:396](../apps/web/src/features/prospects/PipelinePage.tsx:396)). Kenyataannya ([:169-218](../apps/web/src/features/prospects/PipelinePage.tsx:169)):

| Kolom tujuan | Yang terjadi |
| --- | --- |
| Baru, Terhubung | Ditolak dengan toast |
| Terkualifikasi, Ditawarkan, Keberatan, Closing, Deal, Batal, Follow-up | Membuka form/modal |
| Deal oleh CS | Ditolak, lalu membuka modal unggah bukti |

Selama drag, kolom Baru/Terhubung tetap disorot "bisa dilepas" karena `canDrop` hanya memakai `canTransitionStatus`. Menu "…" → *Pindahkan status* juga menawarkan Baru/Terhubung yang selalu ditolak ([:761](../apps/web/src/features/prospects/PipelinePage.tsx:761)).

**Saran:** tandai kolom yang tidak bisa dituju secara manual sebagai non-droppable saat drag. Tulis label jujur di kolom tujuan ("Lepas untuk buat penawaran", "Lepas untuk catat alasan batal"). Sembunyikan Baru/Terhubung dari menu. Ubah petunjuk menjadi "Tarik kartu untuk memulai langkah berikutnya".

### P4 — Tinggi (bug) — Filter paket dan sumber lead diabaikan saat chip cepat aktif

Di fungsi filter ([:116-129](../apps/web/src/features/prospects/PipelinePage.tsx:116)), chip *High intent / Deal / Batal / Baru* langsung `return` sebelum filter paket dan sumber lead diperiksa. Akibatnya "Deal + Paket Syawal" menampilkan **semua** Deal, sementara tombol Filter tetap menunjukkan "1 filter aktif". Chip juga tidak menampilkan jumlah, dan status filter tidak tersimpan di URL sehingga hilang saat reload dan tidak bisa dibagikan.

**Saran:** gabungkan semua kondisi (AND), tampilkan jumlah per chip, dan simpan `quick`/`paket`/`sumber`/`q` di query string.

### P5 — Sedang (bug) — Klaim PIC gagal tanpa pesan; tabel menawarkan klaim ke semua role

`claim` tidak punya `onError` ([:164](../apps/web/src/features/prospects/PipelinePage.tsx:164)). Di tabel, tombol "Klaim PIC" muncul untuk setiap prospek tanpa PIC dan untuk semua role ([:522](../apps/web/src/features/prospects/PipelinePage.tsx:522)), padahal backend hanya mengizinkan CS. Admin, Finance, dan Superadmin menekan tombol itu dan tidak terjadi apa-apa (403 diam-diam). Admin juga belum punya cara menugaskan PIC dari Pipeline (A08).

**Saran:** tampilkan "Klaim" hanya untuk CS, "Tugaskan PIC" untuk admin, dan toast bila gagal.

### P6 — Sedang — Informasi kartu kurang bermakna

- **Rp 0** tampil di setiap prospek yang belum punya nilai, dan kolom Baru/Terhubung bertuliskan "Total Potensi Rp 0". Nol di sini berarti "belum ada penawaran", bukan nilai. Tampilkan "Belum ada penawaran" atau sembunyikan.
- Kontak tanpa nama menampilkan nomor dua kali (`+6285135969298` / `6285135969298`, [:779-780](../apps/web/src/features/prospects/PipelinePage.tsx:779)).
- PIC ditulis abu-abu kecil di kanan tanpa ikon atau label ("Fitri"), dengan gaya yang sama dengan "Tanpa PIC". Prospek tanpa PIC adalah antrean kerja, tetapi tidak menonjol.
- Kartu tidak menampilkan umur prospek atau waktu pesan terakhir, padahal ini sinyal prioritas utama CS.

### P7 — Sedang — Keterbacaan: teks terlalu kecil dan kontras kurang

- 10 elemen memakai `text-[9px]` (lencana status, label menu) dan 10 memakai `text-[10px]`. Ukuran 9 px sulit dibaca di monitor kantor.
- `text-zinc-400` (#a1a1aa) di atas putih hanya 2,6:1, di bawah batas WCAG AA 4,5:1. Dipakai 13 kali, termasuk nomor telepon, nama PIC, placeholder, dan header tabel.

**Saran:** minimum 11 px untuk teks informatif; teks sekunder memakai `zinc-500` (4,8:1).

### P8 — Sedang — Umpan balik status tidak konsisten

- Error perubahan status tampil sebagai kotak merah statis di atas board ([:406](../apps/web/src/features/prospects/PipelinePage.tsx:406)), jauh dari kartu yang di-drag, tanpa tombol tutup, dan bertahan sampai reload.
- Toast memakai `setTimeout` tanpa pembersihan, sehingga toast lama bisa menghapus toast baru.
- Setelah drag, kartu langsung pindah (optimistic). Bila server menolak, kartu kembali tanpa animasi atau penjelasan di kartu itu.

### P9 — Rendah — Bahasa dan gaya belum konsisten

- Campuran Inggris–Indonesia: *High intent, Board, Log follow-up, Simpan log, Closed Lost, Konfirmasi Lost*.
- Lencana memakai emoji berwarna (⚠️ 🧾 📤 ⏰ 🔔) dan warna rose/amber/blue/emerald, padahal AGENTS §3 mengatur palet status monokrom dengan hijau hanya untuk Deal.
- `LostReasonDialog` ([:829](../apps/web/src/features/prospects/PipelinePage.tsx:829)) adalah kode mati: `setLostDialog({open:true})` tidak pernah dipanggil, dan dialog itu menulis status lama `closed_lost`. Hapus agar tidak dipakai ulang tanpa sengaja.
- Tanggal minimum di dialog follow-up memakai tanggal UTC ([:977](../apps/web/src/features/prospects/PipelinePage.tsx:977)). Antara 00.00–07.00 WIB, "kemarin" masih bisa dipilih.

### P10 — Rendah — Loading tanpa kerangka

Seluruh halaman diganti spinner "MEMUAT PIPELINE" sampai data datang. API-nya cepat (147 ms), jadi waktu tunggu yang terasa lebih banyak berasal dari pemuatan modul halaman. Skeleton kolom akan terasa lebih cepat, dan menjaga posisi scroll saat refetch realtime.

## Yang sudah baik

- Aksi terpandu per tahap: drop ke Ditawarkan membuka penawaran resmi, ke Closing membuka invoice, dan seterusnya. Jalur status tetap mengikuti aturan bisnis.
- Ada alternatif selain drag (menu "…" per kartu) dan pengumuman `aria-live` untuk perpindahan.
- Antrean "Follow-up hari ini / terlambat / Belum ada PIC" memakai tanggal bisnis WIB dari backend.
- Tampilan tabel tersedia dan export CSV aman.
- Nama beraksara Arab tampil benar.

## Prioritas perbaikan

1. **P4 dan P5** (bug): gabungkan filter dengan logika AND, simpan filter di URL; tombol klaim sesuai role, dengan pesan error.
2. **P1 + P2** (satu paket desain ulang kartu): kartu ringkas, aksi selalu terlihat, kolom dengan scroll internal dan header sticky, strip ringkasan tahap.
3. **P3**: target drop dan menu status yang jujur.
4. **P6–P8**: isi kartu, keterbacaan, umpan balik.
5. **P9–P10**: bahasa, palet, kode mati, skeleton.

## Kriteria selesai

| Skenario | Hasil wajib |
| --- | --- |
| CS di tablet membuka Pipeline | Tombol Chat/Follow-up terlihat tanpa hover |
| Viewport 1440×680 | ≥5 kartu per kolom terlihat; ada petunjuk kolom di luar layar |
| Drag kartu ke Baru/Terhubung | Kolom tampil tidak aktif sejak awal drag |
| Chip Deal + filter paket | Hanya Deal di paket tersebut; jumlah chip sesuai |
| Admin menekan klaim/tugaskan | Aksi tersedia sesuai role; error tampil bila ditolak |
| Reload halaman dengan filter aktif | Filter tetap sama (dari URL) |
| Teks sekunder | Kontras ≥4,5:1, ukuran ≥11 px |

## Catatan tambahan (di luar Pipeline, perlu diverifikasi)

Tab browser baru di jendela yang sama terbuka dalam keadaan **logout**, padahal tab lain sedang login. Dugaan: dua tab melakukan refresh token bersamaan, lalu karena backend merotasi token, salah satu tab ditolak dan kini diarahkan ke login oleh penanganan sesi yang baru. Single-flight refresh saat ini hanya berlaku di dalam satu tab. Perlu diuji dengan dua tab: bila benar, koordinasikan refresh antartab (mis. `BroadcastChannel`/Web Locks) atau beri toleransi token lama beberapa detik di backend.

## Status perbaikan (23/09, sesi yang sama)

| Temuan | Status | Perubahan |
| --- | --- | --- |
| P1 aksi hover-only | Diperbaiki | Chat dan Catat follow-up selalu tampil sebagai ikon berlabel di kartu dan di baris tabel; tidak ada lagi `opacity-0`. |
| P2 kepadatan board | Diperbaiki | Kartu ringkas (nama, kota/nomor + aktivitas terakhir, nilai atau "Belum ada penawaran", lencana hanya bila ada, PIC + aksi). Kolom dengan tinggi tetap dan scroll internal (header selalu terlihat), bisa dilipat (tersimpan per browser). Strip ringkasan 9 tahap (jumlah + nilai, klik untuk lompat). Bayangan tepi + tombol geser saat ada kolom di luar layar. |
| P3 drag-and-drop | Diperbaiki | `dropAction()` menentukan kolom yang bisa dituju; Baru/Terhubung dan kolom asal tampil non-aktif sejak drag dimulai, dan setiap kolom menampilkan labelnya ("Lepas untuk buat penawaran resmi", dst.). Menu "…" hanya berisi langkah yang valid, masing-masing dengan keterangan. |
| P4 filter | Diperbaiki | Pencarian, paket, dan sumber digabung dengan AND, lalu chip cepat. Chip menampilkan jumlah. `view/quick/q/paket/sumber` tersimpan di URL. Chip "Baru" (duplikat kolom) diganti "Belum dibalas". |
| P5 klaim/tugaskan | Diperbaiki | Klaim hanya untuk CS; Admin/Superadmin mendapat "Tugaskan PIC"/"Ganti PIC" (dialog pilih CS aktif brand tersebut, bisa melepas PIC). Semua mutasi menampilkan pesan bila gagal. `GET /catalog/users` untuk admin kini menghormati `brandId` yang berhak. |
| P6 isi kartu | Diperbaiki | "Rp 0" diganti "Belum ada penawaran"; nomor tidak lagi tampil dua kali; PIC berikon; tambahan sinyal aktivitas terakhir dan "Belum dibalas" (pesan terakhir dari jamaah). |
| P7 keterbacaan | Diperbaiki | Tidak ada teks 9/10 px di halaman ini (minimum 11 px); teks informatif memakai `zinc-500` ke atas. |
| P8 umpan balik | Diperbaiki | Error status tampil sebagai toast berisi nama prospek (bisa ditutup) dan kartu dikembalikan; toast memakai satu timer yang dibersihkan. |
| P9 bahasa/gaya | Diperbaiki | Label Indonesia (Papan, Minat tinggi, Catat follow-up, Simpan catatan); lencana monokrom berikon (hitam penuh = mendesak); `LostReasonDialog` mati dihapus; tanggal minimum follow-up memakai tanggal bisnis WIB. |
| P10 loading | Diperbaiki | Skeleton kolom menggantikan spinner satu halaman. |

Tes: `PipelinePage.test.tsx` (filter AND dari URL, tombol PIC per role, isi kartu dan aksi berlabel). Verifikasi visual dengan data login belum dilakukan: tab Chrome baru terbuka dalam keadaan logout dan auditor tidak memasukkan kata sandi.
