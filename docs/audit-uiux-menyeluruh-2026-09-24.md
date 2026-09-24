# Audit UI/UX menyeluruh — 24 September 2026

Status: **G1–G16 diperbaiki (24/09)**, termasuk sisa kecil di Inbox. Lihat bagian "Keputusan dan status".

**Metode:**
- penelusuran kode seluruh `apps/web/src`: 20 halaman, komponen `components/ui`, dan shell aplikasi;
- dua screenshot dari user (sidebar dan halaman Verifikasi);
- pembanding: aturan desain proyek di `AGENTS-csumroh.md` bagian 3 (monokrom, tanpa `<select>` native, nyaman di split-screen ±700 px), WCAG 2.2 AA (kontras, target, keyboard), serta prinsip "satu tempat satu arti".

Tidak ada uji di browser (sesi login tidak tersedia di browser agen), sehingga temuan tampilan berasal dari kode dan dua screenshot tersebut.

## Ringkasan

Masalah terbesar bukan gaya visual, tetapi **model yang tidak konsisten**:
1. pemilih brand di header muncul di halaman yang tidak memakainya;
2. tautan menuju halaman yang tidak ada;
3. Dashboard yang sama untuk semua role;
4. lima komponen/halaman mati.

Setelah itu barulah konsistensi visual: warna di luar aturan monokrom, teks 9–11 px, kontras `zinc-400`, dan dua pola modal serta dua komponen badge.

| Prioritas | Jumlah | Tema |
| --- | --- | --- |
| Tinggi | 5 | Lingkup brand, tautan mati, lonceng sidebar, Dashboard per role, menu tidak relevan |
| Sedang | 6 | Kode/halaman mati, penamaan, komponen ganda, warna, tipografi, kontras |
| Rendah | 5 | Keyboard, `confirm()` native, indikator teknis, tabel lebar, empty state |

---

## Tinggi

### G1 — Pemilih brand di header tidak berlaku di banyak halaman (screenshot 2)

Header menampilkan pemilih brand global (`AppShell.tsx:403`) di **semua halaman kecuali Ringkasan**. Hanya sebagian halaman yang membacanya (`useBrandScope`).

| Halaman | Pemilih header | Filter brand di halaman | Akibat |
| --- | --- | --- | --- |
| Verifikasi | tampil, **diabaikan** | "Semua brand" (default) | Header "Hana Tours" dan halaman "Semua brand" tampil bersamaan: dua jawaban berbeda untuk pertanyaan yang sama |
| Paket Umroh | tampil, diabaikan | "Semua Brand" | Sama |
| Staff | tampil **dan** dipakai | "Semua Brand" | Daftar sudah dibatasi brand header (`/catalog/users?brandId=`), jadi filter lokal hanya bisa memberi hasil yang sama atau kosong (`StaffPage.tsx:480,496`) |
| Meta CAPI | tampil dan dipakai | pilihan brand sendiri | Dua pemilih untuk satu hal |
| Brand, Detail Brand, Detail Perangkat, Akademi CS, Pengaturan Notifikasi | tampil, tidak relevan | — | Mengubahnya tidak berpengaruh apa pun |
| Inbox, Pipeline, Detail Prospek, Perangkat | tampil dan dipakai | — | Benar |

**Rekomendasi:**
- Tetapkan lingkup per rute: `brand` (operasional: Inbox, Pipeline, Detail Prospek, Perangkat, Staff), `holding` (lintas brand dengan filter lokal: Ringkasan, Verifikasi, Paket, Meta CAPI), atau `none` (Brand, Akademi, Pengaturan).
- Pemilih header hanya tampil untuk `brand`.
- Staff cukup satu filter.

### G2 — Tautan menuju halaman yang tidak ada

Di kartu "Akses Cepat" Dashboard (`DashboardPage.tsx:550`):
- "Buku Kontak" menuju `/contacts`, padahal `ContactsPage` ada tetapi **tidak punya rute**;
- "Script CS" menuju `/scripts`, yang juga tidak ada rutenya (skrip sudah pindah ke Copilot di Inbox).

Keduanya jatuh ke rute `*` dan diam-diam kembali ke Ringkasan.

**Rekomendasi:** putuskan nasib Buku Kontak (daftarkan rute dan menu, atau hapus halamannya). Arahkan "Script CS" ke Inbox (Copilot) atau hapus tautannya.

### G3 — Lonceng notifikasi di sidebar tidak menyatu (screenshot 1)

Lonceng yang ditambahkan pada fase notifikasi (`AppShell.tsx`, blok `hidden px-4 pb-2 lg:block`) menempel di bawah daftar menu yang bisa di-scroll:
- saat sidebar melebar, semua item punya label sementara lonceng hanya ikon;
- bayangan/indikator scroll menu menimpa area lonceng;
- lencana angka tampak terjepit di antara "Meta CAPI" dan kartu akun.

**Rekomendasi:** jadikan satu baris bergaya menu ("Notifikasi" + lencana di kanan, ikon saja di mode rail), ditempatkan di area footer bersama akun, bukan di antara menu yang bisa di-scroll.

### G4 — Dashboard sama untuk semua role

"Ringkasan Sales" (`DashboardPage.tsx:117`) menampilkan hal yang sama untuk CS, Finance, dan Admin: total prospek, total dan nilai deal, konversi, status WhatsApp Gateway, kuota paket, serta banner lebih bayar dan dana refund (`:162`).

- **CS** melihat angka keuangan seluruh brand, tetapi **tidak** melihat pekerjaannya: jamaah menunggu balasan, follow-up hari ini/terlambat, prospek yang bisa diambil alih, invoice lewat tempo.
- **Finance** tidak melihat antrean verifikasi (jumlah, yang lebih dari 2 jam), bukti ditolak, dan refund sebagai daftar kerja.
- **Admin** tidak melihat SLA balasan, lead tanpa PIC, dan perangkat terputus sebagai daftar kerja.

**Rekomendasi:** Ringkasan per role berupa "yang perlu saya kerjakan hari ini" di atas metrik. Datanya sudah ada di API (filter pipeline, `awaitingSince`, antrean verifikasi, notifikasi). Angka keuangan brand cukup untuk Finance/Admin.

### G5 — Menu tidak relevan untuk role

`mainNav` (`AppShell.tsx:16`) hanya menyaring "Verifikasi":
- **Finance** melihat "Akademi CS" (materi melayani jamaah), "Kotak masuk" (hanya bisa membaca, karena membalas tertutup), dan "Pipeline" (tidak bisa menyeret atau mengubah prospek).
- **Pengaturan Notifikasi** hanya bisa dicapai lewat menu akun atau ikon gerigi.

**Rekomendasi:**
- Menu per role. Finance: Ringkasan, Verifikasi, Pipeline (baca), Paket.
- "Akademi CS" hanya untuk CS dan Admin.
- Kotak masuk untuk Finance cukup sebagai tautan "Buka chat" dari antrean verifikasi.

---

## Sedang

### G6 — Halaman dan komponen mati (±2.000+ baris)

| Berkas | Status |
| --- | --- |
| `features/admin/AdminPage.tsx` | Rute `/admin` diarahkan ke `/`; menu disembunyikan dengan `false &&` (`AppShell.tsx:220`) |
| `features/admin/MetaSettingsPanel.tsx` | Hanya dipakai AdminPage; fungsinya sudah ada di Meta CAPI |
| `features/packages/PackageFormModal.tsx`, `PackageDetailModal.tsx` | Hanya dipakai AdminPage; sudah ada `PackageFormPage` dan `PackageDetailPage` |
| `features/contacts/ContactsPage.tsx` | Tanpa rute (lihat G2) |

Kode mati ikut memperbesar audit (sebagian besar pelanggaran warna dan ukuran teks di tabel G9–G10 berasal dari sini) dan membingungkan agen/pengembang berikutnya.

**Rekomendasi:** hapus, atau hidupkan kembali secara sadar.

### G7 — Satu halaman, tiga nama

| Menu | Breadcrumb | Judul halaman |
| --- | --- | --- |
| Pipeline | Pipeline CRM | Prospek Jamaah |
| Ringkasan | Ringkasan | Ringkasan Sales |
| Staff | Manajemen Staff | Manajemen Staff |
| Brand | Brand Travel | Brand Travel |
| Kotak masuk | (Inbox tanpa header) | — |

Istilah juga bercampur Inggris dan Indonesia: Staff, Pipeline, Deal, Realtime aktif, Meta CAPI, Copilot.

**Rekomendasi:** satu glosarium. Contoh: Pipeline = "Pipeline Prospek" di semua tempat; Staf/Staff dipilih satu. Label menu = breadcrumb = judul.

### G8 — Komponen ganda untuk hal yang sama

- **Modal:** 10 berkas memakai `ModalFrame` standar (fokus terkunci, Escape, kembali ke pemicu); 13 berkas masih memakai `Dialog.Root` Radix langsung dengan gaya masing-masing (Brand, Paket, Staff, Meta CAPI, Pipeline, dan lain-lain). Ini bertentangan dengan `AGENTS-csumroh.md` §3 ("wajib di `components/ui`, bukan raw Radix per fitur").
- **Badge:** `components/ui/badge.tsx` (6 berkas) dan `status-badge.tsx` (8 berkas) dengan warna berbeda untuk status yang sama.
- **Kartu:** kelas `surface` langsung (9 berkas) vs komponen `Card` (5 berkas).

### G9 — Warna di luar aturan monokrom

Aturan proyek: hitam, putih, dan abu. Satu-satunya pengecualian adalah badge Closed Won (`emerald-600`).

| Area | Kelas warna non-monokrom | Warna hex |
| --- | --- | --- |
| Inbox | 107 | 161 (palet WhatsApp `#00a884`, `#f0f2f5`, `#111b21`, …) |
| Profil & Copilot | 71 | 18 |
| Staff | 34 | — |
| Meta CAPI | 28 | — |
| badge.tsx / status-badge.tsx | 28 / 20 | — |
| Dashboard, Paket, Detail Paket, Brand, modal chat | 14–23 per berkas | — |

Inbox sengaja meniru WhatsApp Web. Ini **keputusan desain yang perlu dikonfirmasi**: meniru WhatsApp (tidak sesuai aturan) atau monokrom seperti bagian lain aplikasi. Saat ini aplikasi terasa seperti dua produk.

**Rekomendasi:** warna hanya untuk makna (error = rose, sukses/Deal = emerald, peringatan = amber), didefinisikan sebagai token. Selebihnya abu-abu.

### G10 — Teks terlalu kecil

**303** pemakaian `text-[9px]`–`text-[11px]`. Terbanyak di Inbox (34), Meta CAPI (24), Admin (23, mati), Detail Paket (21), dan Paket modal (19). Pipeline sudah dibersihkan di audit U4.

**Rekomendasi:** minimal 12 px untuk teks informatif. 11 px hanya untuk angka di lencana.

### G11 — Kontras rendah

`text-zinc-400` dipakai **271** kali di 39 berkas, termasuk untuk teks yang dibaca (subjudul, label kolom, "Semua brand" di Staff `:717`). Di latar putih kontrasnya ±2,6:1, di bawah batas WCAG 4,5:1.

**Rekomendasi:** `zinc-500` minimal untuk teks sekunder, `zinc-600` untuk teks kecil. `zinc-400` hanya untuk ikon dekoratif dan placeholder.

---

## Rendah

- **G12 — Keyboard.** Tiga lencana PIC di header chat Inbox adalah `<span onClick>` (`InboxPage.tsx`, blok "PIC Status Badge"). Tidak bisa difokus atau diaktifkan dengan keyboard; seharusnya `<button>`.
- **G13 — `confirm()` native** di Meta CAPI (`MetaCapiPage.tsx:510`, hapus access token). Seharusnya memakai dialog konfirmasi aplikasi.
- **G14 — Indikator teknis.** "Realtime aktif" di header adalah istilah teknis. Pengguna cukup diberi tahu saat koneksi **terputus** (dengan dampaknya), tidak perlu indikator hijau permanen.
- **G15 — Split-screen ±700 px.**
  - Tabel Brand (`min-w-[820px]`) dan Meta CAPI (`min-w-[760px]`) memaksa scroll horizontal pada layar setengah.
  - Pipeline sudah otomatis ke Tabel di bawah 900 px (U10); halaman lain belum punya perlakuan serupa.
- **G16 — Empty/loading state tidak seragam.** Ada `components/ui/empty.tsx`, `page-feedback.tsx`, dan banyak `<p className="text-center text-zinc-500">` buatan sendiri per halaman.

---

## Urutan perbaikan yang disarankan

1. **G1, G2, G3:** kebingungan langsung yang terlihat user. Perbaikannya kecil: metadata lingkup per rute, tautan, dan lonceng sebagai item menu.
2. **G5 dan G4:** menu dan Ringkasan per role. G4 paling besar dampaknya untuk kerja harian.
3. **G6:** hapus kode mati sebelum merapikan visual, agar G9–G11 tidak dikerjakan di berkas yang tidak dipakai.
4. **G8:** satukan modal, badge, dan kartu, lalu **G9–G11** (token warna, ukuran teks, kontras) lewat komponen bersama.
5. **G7, G12–G16:** penamaan, keyboard, konfirmasi, indikator, split-screen, empty state.

## Keputusan yang dibutuhkan

1. **Inbox:** tetap bergaya WhatsApp Web (hijau) atau ikut monokrom? (G9)
2. **Buku Kontak:** dihidupkan (rute dan menu) atau dihapus? (G2, G6)
3. **Menu Finance:** perlu Kotak masuk dan Akademi CS? (G5)
4. **Istilah baku:** Staff atau Staf; Pipeline atau Prospek; Deal atau Closing. (G7)

## Keputusan dan status

**Keputusan user (24/09):**
1. **Inbox tetap bergaya WhatsApp Web (hijau).** Ini pengecualian resmi dari aturan monokrom, hanya untuk Inbox dan panel Profil/Copilot di dalamnya. G9 untuk halaman lain tetap berlaku.
2. **Buku Kontak dihapus.**
3. **Menu Finance:** Kotak masuk tetap ada (untuk cek percakapan); Akademi CS disembunyikan.
4. **Istilah baku:** **Staf**, **Pipeline**, **Deal**. Tahap `closing` tetap berlabel "Tunggu Verifikasi" dan tidak diganti.

| Temuan | Status | Perubahan |
| --- | --- | --- |
| G1 lingkup brand | Diperbaiki | Pemilih brand header hanya tampil di halaman yang datanya mengikuti brand aktif (`followsActiveBrand`: Pipeline, Detail Prospek); Inbox memakai pemilih di headernya sendiri. Verifikasi, Paket, Meta CAPI, dan Ringkasan memakai filter halamannya sendiri. **Staf:** filter di halaman kini menentukan query (Superadmin "Semua Brand" = semua staf; Admin melihat staf brand utamanya, sesuai aturan kelola CS brand sendiri). **Perangkat:** Admin dan Superadmin melihat semua perangkat. |
| G2 tautan mati | Diperbaiki | "Akses Cepat" di Ringkasan diganti pintasan per role ke tampilan terfilter yang benar-benar ada: CS (menunggu balasan, follow-up hari ini/terlambat, prospek saya), Finance (antrean verifikasi, booking Deal), Admin (lead tanpa PIC, menunggu balasan, antrean verifikasi, perangkat). Tautan mati `/contacts`, `/scripts`, `/finance` dihapus. |
| G3 lonceng sidebar | Diperbaiki | Lonceng pindah ke area akun (footer sidebar) sebagai baris bergaya menu: ikon dan lencana di mode rail, label "Notifikasi" saat sidebar melebar/drawer. Tidak lagi berada di antara menu yang bisa di-scroll. |
| G5 menu per role | Diperbaiki | "Akademi CS" hanya untuk CS/Admin/Superadmin. Finance: Ringkasan, Kotak masuk, Pipeline, Verifikasi, Paket. |
| G6 kode mati | Diperbaiki | Dihapus: `ContactsPage`, `AdminPage`, `MetaSettingsPanel`, `PackageFormModal`, `PackageDetailModal`, menu Admin tersembunyi (`false &&`), dan rute `/admin`. `WhatsAppDevicePanel` dipertahankan (dipakai Detail Perangkat). |
| G7 penamaan | Diperbaiki | Menu, breadcrumb, dan judul disamakan: Ringkasan, Pipeline, Staf, Brand Travel, Perangkat WhatsApp. "Staff" menjadi "Staf" di semua teks (termasuk pesan API hapus staf). "Closing" dalam arti menang menjadi "Deal" (Konversi Deal, Meta CAPI Purchase = Deal). Modal invoice dan bukti transfer menyebut tahap "Tunggu Verifikasi" sesuai badge. |
| G4 Ringkasan per role | Diperbaiki | Bagian **"Perlu dikerjakan sekarang"** di atas metrik Ringkasan (`TodayTasks`, endpoint `GET /dashboard/tasks`). Mendesak tampil lebih dulu, yang beres diredupkan ("Tidak ada"), setiap kartu menuju tampilan terfilter, dan diperbarui tiap menit serta saat ada event realtime. **CS:** jamaah menunggu balasan (terlama, mendesak ≥ 10 menit), follow-up hari ini/terlambat, invoice lewat tempo, bisa diambil alih, lead tanpa PIC, dan daftar 5 jamaah miliknya yang menunggu. **Finance:** bukti menunggu (mendesak ≥ 2 jam, terlama), perlu refund (nominal), kelebihan bayar, invoice lewat tempo, dan 5 bukti terlama. **Admin/Superadmin:** jamaah belum dibalas 15+ menit (mendesak bila ada ≥ 30), lead tanpa PIC, perangkat WA terputus (nama brand), bukti menunggu (> 1 hari), brand tanpa CS aktif, dan 5 percakapan terlama beserta PIC-nya. SLA dihitung dari daftar percakapan Inbox (sama dengan tombol Ambil alih dan notifikasi). Banner rekonsiliasi keuangan tidak lagi tampil untuk CS, dan tautannya diperbaiki (`/finance` ke `/verifikasi`). "Akses Cepat" dihapus karena digantikan daftar kerja. |
| G8 komponen ganda | Diperbaiki | **Modal:** `Modal` dan `ConfirmDialog` baru di `components/ui/modal.tsx`. 7 dialog konfirmasi yang ditulis ulang (hapus brand ×3, hapus paket ×2, hapus staf, putuskan perangkat WA) dan 5 modal isi (detail log & uji event Meta CAPI, form staf, catat follow-up, Tugaskan/Serahkan PIC, tolak bukti) kini memakainya: judul terlihat sekaligus menjadi nama dialog, tombol tutup, isi yang bisa di-scroll, dan footer aksi yang seragam. Lightbox flyer paket menjadi `components/ui/image-lightbox.tsx` (kini dengan judul dialog dan label tombol). `Dialog.Root` mentah di fitur tinggal `ChatSidePanel` (drawer, pengecualian). **Dialog hapus brand kini jujur:** API menolak menghapus brand yang masih punya prospek/paket, sehingga dialog menampilkan jumlahnya dan menonaktifkan tombol, bukan menjanjikan "hapus semua data". **Badge:** `Badge` (status prospek) kini dibangun di atas `StatusBadge` dengan varian sesuai AGENTS §3: Deal hijau solid, tahap berjalan bergaris hitam, Baru abu, Batal dicoret. Sebelumnya 8 warna berbeda (biru, ungu, indigo, teal, …). Teks badge 12 px; varian `info` menjadi monokrom. **Kartu:** `Card` memakai `.surface` sebagai satu sumber gaya; judul `CardHeader` disamakan dengan judul seksi lain (14 px semibold). Aturan pemakaian ditambahkan ke `AGENTS-csumroh.md` §3. |
| G13 `confirm()` native | Diperbaiki | Hapus access token Meta CAPI memakai `ConfirmDialog`. |
| G9 warna | Diperbaiki | 56 kelas warna di luar palet diganti: biru, ungu, indigo, teal, dan sejenisnya menjadi zinc pada tingkat yang sama; `green` menjadi emerald, `red` menjadi rose, `yellow`/`orange` menjadi amber; fokus hijau WhatsApp di modal kualifikasi menjadi hitam seperti `.field`. Sisa warna hanya semantik (emerald/rose/amber). Inbox dan panel di dalamnya dikecualikan (keputusan user). |
| G10 ukuran teks | Diperbaiki | 186 teks 9–11 px menjadi 12 px (`text-xs`), termasuk komponen bersama (badge, kartu, stat card, header). Tersisa 4 teks 11 px, semuanya angka di lencana hitungan. |
| G11 kontras | Diperbaiki | 175 teks `zinc-300/400` di latar terang menjadi `zinc-500` (≥ 4,5:1). Teks di latar gelap dibiarkan atau **dinaikkan** ke `zinc-400`: label "Pengelolaan", role pengguna, dan tagline sidebar sebelumnya `zinc-500` di atas hitam (±4:1), begitu juga item aktif di Akademi CS dan panduan Detail Prospek. Sisa 20 `zinc-300/400` semuanya di latar gelap. |
| G12 keyboard | Diperbaiki | Lebih luas dari temuan awal: **item daftar percakapan Inbox** adalah `<div onClick>` sehingga chat tidak bisa dibuka dengan keyboard. Kini `role="button"`, `tabIndex`, Enter/Spasi, dan cincin fokus. Lencana PIC (2) dan status di header chat menjadi `<button>` berlabel. Kutipan pesan (lompat ke pesan asli), gambar pesan, thumbnail flyer di Profil, dan area unggah flyer paket bisa diaktifkan dengan keyboard. Kartu perangkat (berisi tombol lain) mendapat tautan fokus di judulnya. |
| G14 indikator realtime | Diperbaiki | "Realtime aktif" permanen dihapus. Indikator hanya tampil saat bermasalah: "Menyambung ulang…" setelah 4 detik (tidak berkedip saat halaman dibuka) dan "Pembaruan otomatis terhenti" (amber) saat terputus, kini juga di layar kecil. Wadah `role="status"` selalu terpasang agar perubahan diumumkan. |
| G15 tabel split-screen | Diperbaiki | Selain Brand (820 px) dan Meta CAPI (760 px), ternyata **Pipeline (960 px)**, tabel bawaan di layar < 900 px, dan Paket (940 px) juga memaksa scroll horizontal. Lebar minimum kini hanya mulai `lg`; kolom sekunder disembunyikan di bawah `lg`: Pipeline (Paket, Nilai), Paket (Brand, Promo), Brand (Legalitas, Rekening), Meta CAPI (Respons). Staf (720 px) hanya mulai `lg`. |
| G16 empty state | Diperbaiki | Satu komponen `EmptyState` (varian `plain`/`section`: ikon, judul, alasan, aksi); `SectionEmpty` menjadi alias; `empty.tsx` yang tidak dipakai dihapus. Dipakai di Brand, Paket, Staf, dua antrean Verifikasi, riwayat Detail Prospek, dan tabel Pipeline. Staf kini membedakan "tidak cocok filter" dan "belum ada staf" (sebelumnya selalu menyarankan ubah filter). |

**Sisa kecil di Inbox (diperbaiki):**
- **Tiga modal buatan sendiri** kini memakai komponen bersama (kunci fokus, Escape, fokus kembali ke pemicu): pratinjau media menjadi `ImageLightbox` (dengan tombol unduh), konfirmasi hapus pesan menjadi `ConfirmDialog`, dan pemilih paket menjadi `ModalFrame` dengan tata letak bergaya WhatsApp yang dipertahankan.
- **Header chat:** avatar dan nama kini `<button>` dengan `aria-expanded` (buka/tutup panel Profil & Copilot). **Bug ikut diperbaiki:** tombol kembali (mobile) sebelumnya berada di dalam area klik sehingga ikut membuka/menutup panel; kini di luar.
- **`ImageLightbox`:** klik area gelap di luar gambar kini benar-benar menutup (sebelumnya konten layar penuh menelan klik tersebut).
- Tes: header chat (tombol + `aria-expanded`, item percakapan bisa difokus) di `navigation.test`, dan lightbox (klik luar, unduh). Total web 54/54.

**Catatan:**
- Endpoint API `/api/v1/contacts` (dipakai Buku Kontak) kini tidak dipakai web lagi. Sebaiknya ikut dihapus agar tidak menjadi permukaan API mati. Belum dihapus karena berada di luar lingkup UI.

**Tes:**
- Web: 43/43 (+2 di `app/shell.test.tsx`: menu Finance dan pemilih brand per halaman; +2 di `TodayTasks.test.tsx`; `navigation.test` disesuaikan).
- API: 112/112 (+4 di `tasks.service.test.ts`: CS, CS semua beres, Finance, Admin).
- G8: +3 tes di `components/ui/modal.test.tsx` (Modal, ConfirmDialog, varian Badge); total web 46/46.
- G9–G11: tes penjaga `src/design-rules.test.ts` memindai semua berkas UI (di luar Inbox) untuk warna di luar palet, hex, teks < 12 px, `<select>` native, dan `confirm()`; terbukti gagal saat diberi berkas pelanggar. Total web 50/50.
- G12–G16: aturan penjaga tabel split-screen (terbukti menangkap tabel `min-w-[960px]`), tes indikator realtime (diam/4 detik/terputus), dan `EmptyState`. Total web 53/53.

**Batasan G4:**
- Untuk Admin/Finance dengan cakupan "Semua brand", kartu yang menuju Pipeline membuka Pipeline brand aktif (Pipeline berbasis satu brand).
- Daftar "terlama" dan hitungan tetap mencakup semua brand dan menautkan langsung ke percakapan masing-masing.
