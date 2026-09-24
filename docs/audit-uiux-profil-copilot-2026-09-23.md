# Audit UI/UX end-to-end Profil Prospek dan Copilot

Tanggal: 23 September 2026. Konteks: CRM internal Azhan Grup, lima brand dalam satu holding, CS diawasi marketing & growth.

**Kesimpulan:** struktur panel sudah mudah dikenali, tetapi alur kerja Profil → Copilot → pesan → tindak lanjut belum menjaga konteks dan draft secara konsisten. Prioritas utama adalah mencegah kehilangan input, mencegah formulir menggunakan konteks prospek sebelumnya, dan memastikan skrip siap kirim berisi fakta yang sudah diverifikasi. Perubahan visual saja tidak menyelesaikan masalah ini.

## Cakupan dan bukti

- Screenshot pengguna: hierarki panel, status, aksi, tab, kartu paket, dan footer.
- Browser Chrome yang sudah login: panel Profil/Catatan/Copilot, perpindahan tab, dan penyisipan skrip ke composer. Akun yang terlihat adalah superadmin; perilaku CS/finance lain ditelaah melalui kode, belum diuji dengan sesi masing-masing.
- Kode terkini: ChatSidePanel, ChatProspectProfile, ChatCopilotPanel, InboxPage, modal kualifikasi/penawaran/invoice/keberatan/pembayaran, API client, normalisasi skrip, dan CSS responsif.
- Panduan UI/UX Pro Max dipakai sebagai checklist. Pencarian lokal tidak menemukan panduan spesifik yang tepat untuk kehilangan draft setelah dua pencarian; rekomendasi draft di bawah berasal dari reproduksi dan analisis lifecycle kode, bukan klaim hasil pencarian skill.
- Tidak mengirim WhatsApp, menyimpan perubahan profil, mengganti paket, mengubah status, atau memverifikasi transaksi. Catatan uji hanya lokal dan tidak disimpan; composer dikembalikan kosong dan panel dikembalikan ke Profil/Paket.
- Tidak melakukan benchmark usability, pengukuran contrast numerik, uji seluruh breakpoint, atau simulasi gagal jaringan di browser. Temuan responsive/error/modal yang belum direproduksi diberi dasar inspeksi kode.

**Penting:** kode sudah berubah sejak re-audit sebelumnya. Modal sekarang menggunakan ModalFrame berbasis Radix, preview bukti mempunyai authenticated blob loader, dan modal penawaran mengirim messageText melalui request backend saat pengguna memilih kirim. Temuan lama tentang ketiga area itu tidak otomatis dinyatakan masih berlaku. Audit ini berfokus pada UX versi yang dibaca sekarang.

## Perjalanan pengguna dan titik putus

| Langkah CS | Yang tersedia sekarang | Titik putus |
| --- | --- | --- |
| Buka percakapan | Profil otomatis terbuka, identitas/status/PIC terlihat | Panel default Paket walau kebutuhan utama bisa follow-up atau kualifikasi |
| Lengkapi nama/kualifikasi/catatan | Form dengan tombol simpan per tab | Tidak ada satu save bar; pindah ke Copilot menghilangkan edit lokal |
| Pilih paket | Paket aktif, galeri, harga awal dan tiga aksi | Ganti paket langsung tersimpan, sementara field lain manual; gagal simpan tidak rollback pilihan lokal |
| Cari bantuan balasan | Enam kategori, pencarian, NPGD/TGJP | Default Sapaan, tidak memakai stage/objection/pesan terakhir; pencarian hanya kategori aktif |
| Pakai skrip | Salin dan Sisipkan ke Chat | Sisipkan mengganti draft; TGJP menyisipkan semua langkah beserta label internal |
| Tinjau dan kirim | Composer dan modal penawaran/invoice | State modal tidak selalu diperbarui saat prospek/paket berubah; drawer kecil menutupi composer |
| Catat hasil/keberatan | Modal keberatan dan catatan | Catat keberatan tidak mengarahkan ke skrip yang relevan; tidak ada pencatatan hasil penggunaan skrip |
| Jadwalkan tindak lanjut | Tanggal di tab Catatan | Jadwal tersembunyi dan tanpa jam; stage followup tidak mempunyai CTA utama khusus |
| DP/finance/lanjutan Deal | Upload, menu Finance, nominal pembayaran | Aksi utama tidak menyesuaikan role/pending proof; pelunasan tersembunyi di menu berlabel DP |

## Temuan prioritas

### UX01 — P1 — Edit profil hilang saat berpindah ke Copilot

**Terbukti di browser.** Catatan diberi penanda sementara tanpa disimpan. Setelah Profil → Copilot → Profil → Catatan, isian kembali ke nilai tersimpan dan penanda hilang tanpa peringatan. Subtab juga kembali ke Paket.

`ChatSidePanel` merender salah satu komponen secara conditional; berganti tab meng-unmount komponen lainnya. `isDirty` di dalam Profil hanya melindungi refetch selama komponen hidup. Tutup panel, ganti percakapan, dan navigasi Detail 360° juga perlu kebijakan draft.

**Bukti:** [conditional panel](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatSidePanel.tsx:107), [state lokal](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:103).

**Perbaikan:** simpan draft per brand+prospect di parent/store atau pertahankan panel mounted; bedakan draft dari data server. Berikan save bar persisten dengan Simpan/Buang. Saat benar-benar meninggalkan prospek dengan draft, tawarkan simpan, simpan sebagai draft, atau buang. Pergantian Profil/Copilot sebaiknya tidak memerlukan konfirmasi jika draft dapat dipertahankan otomatis.

### UX02 — P1 — “Sisipkan” menimpa seluruh draft chat

**Terbukti di browser.** Composer diisi teks uji; klik Sisipkan ke Chat menghapus teks itu dan menggantinya dengan skrip. Tidak ada pilihan atau undo khusus. Jalur Format Paket/Itinerary menggunakan callback yang sama; persiapan flyer juga memanggil setMessage(captionText).

**Bukti:** [handler composer](C:/laragon/www/crm-azhan/apps/web/src/features/chat/InboxPage.tsx:416), [insert Copilot](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatCopilotPanel.tsx:156).

**Perbaikan:** sisipkan di posisi kursor atau tambahkan setelah draft. Jika ingin mengganti seluruh isi, namai tindakan “Ganti draft” dan sediakan undo. Toast harus menyebut “Ditambahkan ke draft; belum dikirim”. Skrip panjang wajib bisa ditinjau sebelum pengiriman.

### UX03 — P1 — Modal dapat membawa nilai lama ke prospek atau paket baru

**Inspeksi kode; belum disubmit di browser.** Semua modal di bawah Profil tetap dirender selama `p` ada, meskipun `open=false`. Input modal diinisialisasi dengan useState dari props sekali, tanpa reset effect atau key per prospek. Profil berganti prospek memperbarui form utamanya, tetapi tidak me-remount modal tersebut.

Contoh: paket prospek A digunakan sebagai selectedPkgId awal. Beralih ke B ketika panel tetap terbuka memperbarui `prospect.id`, tetapi selectedPkgId/catatan/nominal modal dapat tetap milik A. Bahkan pada satu prospek, “Ganti Paket” tidak otomatis memperbarui selectedPkgId modal yang sudah mounted. PaymentProof juga mempertahankan fileData saat tutup/buka; Finance mempertahankan nominal, referensi dan idempotency key selama umur komponen.

**Bukti:** [modal selalu mounted](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:1179), [offer initial state](C:/laragon/www/crm-azhan/apps/web/src/features/chat/OfficialOfferModal.tsx:36), [invoice initial state](C:/laragon/www/crm-azhan/apps/web/src/features/chat/OfficialInvoiceModal.tsx:51), [finance state](C:/laragon/www/crm-azhan/apps/web/src/features/chat/FinanceVerifyModal.tsx:52).

**Perbaikan:** scope draft modal ke prospectId+jenis tindakan; mount/reset saat membuka dengan snapshot data terbaru. Pertahankan idempotency key untuk retry operasi yang sama, buat key baru untuk pembayaran baru. Selalu tampilkan nama prospek, brand, paket dan nominal pada review akhir. Uji A→B serta ganti paket A→B dalam prospek yang sama.

### UX04 — P1 — Skrip contoh dapat terlihat sebagai fakta siap dikirim

Copilot menampilkan nama travel/prospek yang sudah dipersonalisasi, tetapi sebagian isi masih hardcode konteks contoh. Browser menampilkan skrip referral yang menyatakan “Bu Rina adalah jamaah kami”, dan skrip keberangkatan dari Medan. Keduanya berasal dari konten template, bukan verifikasi relasi referral/kota prospek. Pengguna dapat menyisipkannya tanpa meninjau variabel yang belum dikonfirmasi.

Itinerary Profil juga masih mengisi default `Direct Saudia/Garuda`, hotel bintang 4/5 dan durasi 9–12 hari bila katalog kosong. Ini dapat menjadi janji layanan yang salah.

**Bukti:** [skrip referral](C:/laragon/www/crm-azhan/packages/scripts-data/scripts-chat/greeting.json:260), [skrip kota](C:/laragon/www/crm-azhan/packages/scripts-data/scripts-chat/greeting.json:247), [itinerary fallback](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:377).

**Perbaikan:** parameter wajib dengan sumber jelas, misalnya nama pemberi referensi dan kota keberangkatan. Jangan isi contoh sebagai fakta default. Tampilkan “Perlu dilengkapi” dan blok final insert/send untuk klaim kritis yang belum valid; data katalog kosong ditulis belum tersedia. Ini tidak memerlukan AI generatif.

### UX05 — P2 — Copilot belum memakai konteks penjualan yang tersedia

Komponen hanya menerima nama, packageId/name dan brand; tidak menerima stage, objection, kebutuhan, payment state, atau pesan terakhir. Kategori awal selalu greeting. Pada browser, prospek Terkualifikasi tetap disambut daftar 30 skrip Sapaan. Angka kategori yang terlihat: 30/39/40/20/46/38, total 213 skrip; itu inventori saat inspeksi, bukan jaminan isi permanen.

**Bukti:** [props dan kategori awal](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatCopilotPanel.tsx:80), [pemanggil](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatSidePanel.tsx:124).

**Perbaikan:** bagian “Disarankan untuk percakapan ini” berisi maksimal tiga opsi, alasan pemilihan, dan kategori manual sebagai fallback. Rules sederhana dari stage/objection/pertanyaan yang dipilih CS sudah cukup. Jangan mengasumsikan CS harus menanyakan bulan/pax ketika jamaah sedang meminta lokasi kantor atau legalitas.

### UX06 — P2 — TGJP dikemas menjadi satu pesan, bukan percakapan bertahap

API menggabungkan Terima, Gali, Jawab, Pastikan dengan label internal ke `item.script`; Copilot menyisipkan seluruhnya. Langkah Gali seharusnya menunggu jawaban sebelum memilih respons berikutnya. Label coaching juga kurang tepat menjadi teks customer-facing secara default.

**Bukti:** [normalisasi TGJP](C:/laragon/www/crm-azhan/apps/api/src/modules/scripts/scripts.routes.ts:29), [insert item.script](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatCopilotPanel.tsx:393).

**Perbaikan:** tombol per langkah, teks pelanggan tanpa label internal, pilihan Jawab berdasarkan respons jamaah. Tampilkan coaching sebagai catatan internal. Setelah mencatat keberatan dari Profil, tawarkan membuka Copilot langsung pada kategori keberatan yang relevan.

### UX07 — P2 — Pola simpan tidak konsisten dan mudah disalahpahami

Nama bisa diedit dari header saat tab Paket, tetapi tombol simpan hanya ada di Kualifikasi/Catatan. Kedua tombol mengirim seluruh form, sehingga “Simpan Catatan” juga dapat menyimpan perubahan nama/pax/paket. Ganti Paket justru langsung memanggil API sekaligus menandai form dirty. Saat request gagal, pilihan lokal tidak di-rollback; isDirty mencegah refetch menimpanya. Tombol Batal kemudian mencampur makna membuang draft dan perubahan yang sudah tersimpan.

**Bukti:** [ganti paket](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:263), [payload seluruh form](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:294), [nama header](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:423).

**Perbaikan:** satu model jelas: save bar global untuk semua field profil; paket sebagai command eksplisit dengan loading, rollback dan penjelasan dampak. Jangan tampilkan paket sebagai tersimpan sebelum server mengonfirmasi.

### UX08 — P2 — Aksi selanjutnya hanya berdasarkan stage

Pada screenshot, CTA Kirim Penawaran muncul bersama Belum Ada PIC dan titik pada Kualifikasi tanpa penjelasan. Badge stage dan indikator kelengkapan tidak dijelaskan hubungannya. `followup`, `nurture`, dan sejumlah legacy stage tidak punya blok CTA khusus; index yang tidak ditemukan jatuh ke 1/9. Pada closing, Upload Bukti muncul meskipun proof sudah ada; Finance ada di menu tambahan. Pada Deal, kebutuhan pelunasan tidak menjadi CTA utama, sementara menu masih menyebut DP.

**Bukti:** [stage index](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:410), [CTA per stage](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:487), [menu Finance](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:713).

**Perbaikan:** next action mempertimbangkan role, PIC, data tersimpan, jadwal, outcome dan payment submission. Unassigned diarahkan ke klaim/penugasan sesuai peran; supervisor tetap boleh membantu jika kebijakan mengizinkan. Closing dengan proof menjadi Menunggu Finance; finance menjadi Tinjau Bukti; Deal DP menjadi Jadwalkan Pelunasan. Ganti 3/9 dengan “Tahap: Terkualifikasi”; pipeline bukan progress linear karena Lose adalah cabang terminal.

### UX09 — P2 — Follow-up tersembunyi dan tidak terhubung dengan penggunaan skrip

Jadwal hanya berupa tanggal di Catatan. Tidak terlihat pada ringkasan Paket dalam screenshot. Tidak ada aksi “Tindak lanjuti penawaran ini”, hasil follow-up, atau jam janji dari panel. Pencatatan keberatan dan penyisipan skrip tidak membantu CS menjadwalkan tindakan berikutnya.

**Bukti:** [jadwal](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:1105).

**Perbaikan:** ringkasan Next action yang selalu terlihat: jenis, PIC, tanggal+jam WIB, keterlambatan. Setelah aktivitas, sediakan Selesai/Jadwalkan lagi dengan outcome. Jangan menjadikan setiap insert skrip sebagai aktivitas sukses atau status penjualan baru.

### UX10 — P2 — Error data disamarkan sebagai kondisi kosong

Profil hanya memiliki cabang loading sebelum merender `p?.status || 'new'` dan isUnassigned dari data yang mungkin undefined. Copilot menampilkan “Tidak ada skrip yang cocok” ketika request error karena tidak ada cabang isError. Akibatnya gangguan API terlihat seperti prospek baru/tidak ada materi.

**Bukti:** [profil loading tanpa error branch](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:399), [Copilot empty state](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatCopilotPanel.tsx:275).

**Perbaikan:** bedakan loading, error, tidak ditemukan, akses ditolak, dan pencarian kosong. Error memuat profil harus menonaktifkan tindakan sampai data valid dan menawarkan Coba lagi. Pertahankan draft lokal jika refresh gagal.

### UX11 — P2 — Pencarian tampak global tetapi hanya mencari kategori aktif

Placeholder mencakup skrip, keberatan dan sapaan; filter memakai `currentCategoryObj.scripts`. CS di Sapaan yang mencari keberatan bisa mendapat nol hasil meski kategori lain memiliki skripnya. Pencarian juga tetap aktif saat kategori berganti, sehingga hasil tampak tiba-tiba kosong. Tab horizontal dapat menyembunyikan kategori lain.

**Bukti:** [scope pencarian](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatCopilotPanel.tsx:119).

**Perbaikan:** pencarian lintas kategori dengan badge kategori pada hasil, atau label eksplisit “Cari dalam Sapaan”. Tampilkan jumlah hasil dan Hapus filter; simpan kategori/pencarian/scroll per workspace agar bolak-balik Profil tidak memulai ulang.

### UX12 — P2 — Drawer menutupi tujuan penyisipan pada layar lebih kecil

Di bawah 1280px, panel menjadi overlay hingga 390px/92vw dengan backdrop. Callback insert hanya fokus ke composer dan tidak menutup drawer; pengguna bisa diarahkan ke elemen yang tertutup panel. Drawer bukan dialog dan belum punya manajemen fokus/Escape seperti ModalFrame yang baru. Ini kesimpulan kode; belum diukur pada semua ukuran layar.

**Bukti:** [drawer CSS](C:/laragon/www/crm-azhan/apps/web/src/styles/globals.css:56), [insert focus](C:/laragon/www/crm-azhan/apps/web/src/features/chat/InboxPage.tsx:416), [panel](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatSidePanel.tsx:57).

**Perbaikan:** pada mode overlay, selesai insert tutup drawer lalu fokus composer, dengan tombol kembali ke skrip. Gunakan drawer accessible: focus trap ketika modal, Escape, restore focus, background inert. Pertahankan tiga kolom hanya jika area chat tetap cukup lebar. Uji 1366/1280/1024/768/390 px dan zoom 125–200%.

### UX13 — P2 — Label “Batal” dan “Kirim” mempunyai beberapa makna

Batal di header membuang edit; Batal pada toolbar menandai Lost. Kirim Flyer baru menyiapkan preview, sedangkan Format Paket/Itinerary memasukkan draft, dan kirim resmi modal melakukan tindakan eksternal. Pengguna harus mengingat pola berbeda untuk tombol yang berdekatan.

**Perbaikan:** gunakan Buang perubahan, Tandai tidak lanjut, Siapkan flyer, Sisipkan rincian, Sisipkan itinerary, dan Kirim ke WhatsApp pada tindakan final. Pisahkan aksi kehilangan prospek dari aksi rutin. Modal Lost sudah menjadi langkah tambahan; pertahankan alasan wajib tanpa memberi istilah yang ambigu.

### UX14 — P2 — Feedback sukses dan aksesibilitas belum konsisten

Copy memanggil clipboard.writeText tanpa await/catch tetapi langsung menyatakan tersalin. Toast yang sama dirender dua kali di Inbox dan hilang 2,5 detik; browser memperlihatkan dua node pesan sukses setelah insert. Tidak ada live region pada kedua toast tersebut. Banyak teks operasional 9,5–11px, tombol salin/ellipsis kecil, preview flyer berupa div clickable tanpa tombol keyboard. Tabs belum memiliki tab semantics/selected state untuk pembaca layar; menu tambahan belum memakai pola menu keyboard.

**Bukti:** [copy](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatCopilotPanel.tsx:148), [toast pertama](C:/laragon/www/crm-azhan/apps/web/src/features/chat/InboxPage.tsx:915), [toast kedua](C:/laragon/www/crm-azhan/apps/web/src/features/chat/InboxPage.tsx:2650), [preview flyer](C:/laragon/www/crm-azhan/apps/web/src/features/chat/ChatProspectProfile.tsx:837).

**Perbaikan:** satu toast provider, live region sesuai jenis pesan, error persisten dekat aksi, await clipboard dan fallback. Naikkan body operasional ke 12–14px/lebih sesuai ruang; perbesar hit area tanpa harus membesarkan ikon. Gunakan button, label terhubung input, tabs/menu accessible. ModalFrame Radix yang sudah ada adalah fondasi baik; uji restore focus karena trigger dikontrol di luar Dialog.Trigger.

### UX15 — P2 — Informasi pengambilan keputusan kalah oleh area kosong

Pada screenshot, nama paket terpotong satu baris, harga hanya “Mulai”, tanggal keberangkatan dan sisa kuota tidak terlihat, lalu ada ruang kosong besar. Ruang kosong tidak salah dengan sendirinya; masalahnya informasi yang membantu memilih paket dan langkah berikutnya belum tersedia pada tampilan yang sama. Panel tidak menegaskan brand aktif secara lokal; identitas brand bergantung area inbox lain.

**Perbaikan:** kartu paket menampilkan nama dua baris, tanggal, durasi, estimasi untuk pax aktual, kuota dengan waktu pembaruan, dan Buka detail. Tambahkan ringkasan kebutuhan, PIC dan next action. Brand harus tetap terlihat saat drawer menutupi konteks inbox. Jangan mengisi ruang kosong dengan semua data sekaligus.

### UX16 — P2 — Profil dan Copilot belum menutup siklus pembelajaran CS

Copilot mempunyai NPGD/TGJP, tetapi Profil belum menyediakan hasil kebutuhan/pain/gain/dream secara terstruktur yang kembali memengaruhi rekomendasi. Keberatan hanya dicatat, tidak membawa CS ke langkah penanganan. Penggunaan template tidak terhubung dengan hasil tindak lanjut sehingga holding tidak dapat menilai apakah bantuan tersebut berguna.

**Perbaikan:** ringkasan kebutuhan dan hambatan yang dapat dikonfirmasi CS, tautkan templateId/version ke draft/pesan aktual, catat outcome setelah respons. Ukur adopsi dan hasilnya tanpa menganggap korelasi penggunaan template sebagai sebab peningkatan closing. Jangan memaksa semua field lengkap sebelum menjawab pertanyaan sederhana jamaah.

## Rekomendasi struktur dan alur

Pertahankan dua area utama, tetapi jadikan keduanya satu sesi kerja:

1. **Header tetap:** nama, brand, PIC, stage; indikator data tersimpan/draft terpisah.
2. **Aksi berikutnya:** satu CTA sesuai role dan keadaan, alasan singkat, serta jadwal follow-up.
3. **Profil:** Ringkasan/Kualifikasi/Catatan. Paket berada dalam Ringkasan dengan rincian keputusan yang cukup. Satu save bar konsisten untuk perubahan profil.
4. **Copilot:** rekomendasi maksimal tiga skrip dengan konteks pemilihan; pustaka seluruh skrip tetap tersedia. Beri label jelas sebagai template bila belum menganalisis percakapan.
5. **Composer:** gabungkan atau ganti draft secara eksplisit, preview, edit, kemudian kirim. Tidak ada kehilangan draft saat panel berganti.
6. **Setelah kirim:** status hasil kirim yang nyata, catat respons/outcome, dan jadwalkan next action. Untuk pembayaran: pisahkan menunggu jamaah, menunggu finance, ditolak/perlu perbaikan, DP terverifikasi, dan lunas.

| Keadaan | CTA yang disarankan |
| --- | --- |
| Belum ada PIC | Klaim untuk CS / Tugaskan CS untuk supervisor |
| Data kualifikasi belum tersimpan | Simpan kualifikasi; jelaskan field yang kurang |
| Qualified dan paket sesuai | Tinjau penawaran |
| Penawaran terkirim, belum ada respons | Jadwalkan follow-up |
| Ada keberatan | Bantu jawab keberatan → Copilot relevan |
| Invoice aktif, belum ada proof | Ingatkan pembayaran / Catat bukti |
| Proof menunggu finance | Tinjau bukti untuk finance; Menunggu verifikasi untuk CS |
| DP terverifikasi | Jadwalkan pelunasan / Lengkapi data jamaah |
| Lunas | Handover ke operasional |
| Lose/nurture | Tinjau alasan / Jadwalkan kontak ulang jika sesuai |

## Urutan implementasi dan acceptance test

**Urutan 1 — Lindungi data dan ketepatan isi:** UX01–04 dan UX07. Ini lebih mendesak daripada warna/spacing.

**Urutan 2 — Buat alur closing jelas:** UX05–06, UX08–11 dan UX13. Selaraskan aksi dengan percakapan nyata, bukan hanya urutan stage.

**Urutan 3 — Perbaiki produktivitas:** UX12, UX14–16; uji pada ukuran layar kerja CS dan keyboard.

Skenario wajib:

- Edit catatan → Copilot → Profil: draft dan posisi kerja tetap ada.
- Ketik pesan → sisipkan skrip: draft lama dipertahankan atau penggantian disengaja dapat di-undo.
- Buka modal untuk A → tutup → pindah B → buka modal: seluruh field dan target hanya milik B.
- Ganti paket di Profil → buka penawaran: paket dan harga sesuai data terbaru.
- Ganti paket gagal: UI kembali ke data tersimpan dan mempertahankan perubahan field lain.
- API profil/script gagal: tampil error dengan retry, bukan New/empty palsu.
- Cari kata di kategori berbeda: hasil lintas kategori ditemukan atau batas pencarian dijelaskan.
- Jalankan TGJP: kirim satu langkah, tunggu respons, pilih langkah berikutnya; label coaching tidak ikut terkirim.
- Brand/katalog belum lengkap: tidak muncul maskapai, fasilitas, referral, atau jadwal rekaan.
- Stage followup/legacy/Deal DP: CTA yang relevan tetap ada dan progress tidak kembali 1/9.
- Mode drawer: insert menampilkan composer dan fokus benar; Escape/Tab berfungsi.
- Offline: Profil dan Copilot yang tersedia tetap dapat dibaca/diedit sebagai draft; hanya pengiriman yang mengikuti ketersediaan kanal. Saat ini panel masih dirender hanya ketika isConnected.
- Finance: proof baru, ditolak, DP dan pelunasan memiliki tampilan serta tindakan yang berbeda.
- Save dari tiap tab dan Detail 360°: hasil konsisten, draft tidak tertimpa refetch, feedback tidak ganda.

Audit ini menghasilkan rekomendasi dan bukti; belum mengubah implementasi aplikasi atau menyatakan seluruh skenario di atas lulus.
