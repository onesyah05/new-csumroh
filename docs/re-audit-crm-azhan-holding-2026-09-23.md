# Re-audit CRM Azhan Grup Holding — 23 September 2026

**Keputusan: belum dapat dinyatakan seluruh A01–A24 selesai.** Perbaikan nyata sudah ada, tetapi sejumlah jalur utama belum tersambung, ada regresi frontend, dan integritas pembayaran/kuota belum aman. Hasil ini menilai isi working tree saat audit, termasuk perubahan belum di-commit dan file untracked; bukan hanya riwayat Git atau klaim walkthrough.

Acuan bisnis tetap: satu perusahaan/holding, lima brand, CS terpusat di bawah marketing & growth. Akses lintas brand merupakan kebutuhan; pembatasan yang diperlukan adalah kewenangan tindakan, konsistensi data transaksi, serta akses dokumen internal. DP terverifikasi maupun lunas boleh menjadi Deal sesuai arahan dalam walkthrough; Purchase harus memakai nilai booking total yang sah, bukan nominal DP.

## 1. Bukti pengujian dan batas kesimpulan

| Pemeriksaan | Hasil |
| --- | --- |
| Tes bawaan API | 14/14 lulus |
| Tes bawaan frontend | 3/3 lulus |
| Tes shared-types | 6/6 lulus |
| Tes WA gateway | 6/6 lulus |
| TypeScript API, frontend, shared-types, gateway | Keempatnya lulus `tsc --noEmit` |
| Build produksi frontend | Lulus; output audit di `scratch/reaudit-web-build`; warning bundle JS utama sekitar 919 kB minified dan anotasi dependency Zod |
| Diagnostik tambahan terhadap handler produksi | **7 gagal, 2 lulus** dari 9 skenario |

Pengujian tambahan berada di [reaudit.audit.ts](C:/laragon/www/crm-azhan/apps/api/scratch/reaudit.audit.ts) dengan [config opt-in](C:/laragon/www/crm-azhan/apps/api/scratch/reaudit.config.ts). Jalankan dari `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run --config scratch/reaudit.config.ts
```

Tes memanggil business handler yang benar-benar didaftarkan pada Express router. Prisma, scope/auth middleware, socket, CAPI, dan penyedia percakapan dimock; fetch eksternal diblokir. Ini pengujian perilaku handler, **bukan** pengujian autentikasi end-to-end, render browser, maupun pembuktian isolation MySQL aktual. Kegagalan disengaja dipertahankan sebagai reproduksi invariant bisnis yang belum terpenuhi, bukan dianggap lolos dengan mengubah expected result. Nama `.audit.ts` dan konfigurasi eksplisit memisahkan diagnostik dari suite default.

Tidak ada perubahan kode aplikasi, mutasi database operasional, migrasi database, pengiriman WhatsApp, atau pengiriman Meta CAPI dalam re-audit ini. Snapshot data lokal dari audit pertama tidak diambil ulang dan tidak dipakai sebagai bukti keadaan terkini. Uji browser terautentikasi, concurrency pada MySQL terisolasi, deployment migration, serta recovery proses masih diperlukan sebelum sign-off operasional.

**Catatan walkthrough:** total 29 tes dan typecheck bersih berhasil dikonfirmasi. Tetapi [financial-guard.test.ts](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/financial-guard.test.ts:1) hanya menguji kalkulasi/percabangan serta fungsi magic bytes yang disalin ke file tes. File tersebut tidak mengimpor handler produksi, tidak menguji request per role, transisi status melalui API, atau nilai Purchase. Klaim coverage pada bagian “Financial Guard Verification” melampaui tes yang benar-benar ada.

## 2. Masalah utama yang masih menghalangi sign-off

### R01 — P1 — Draft invoice dapat mengubah kas yang sudah disahkan Finance

**Reproduksi handler:** prospek sudah Deal, DP terverifikasi Rp5 juta. CS menyimpan draft invoice Rp10 juta dengan `sendViaWhatsApp:false`. API mengembalikan sukses dan mengubah `dpAmount` menjadi Rp10 juta, tanpa verifikasi baru. Dashboard kemudian memakai kolom yang sama sebagai `totalVerifiedCash`.

Pemisahan izin pada `/profile` tidak cukup karena `/invoice` masih menulis `dpAmount` untuk setiap pengguna yang lolos scope. `/offer` juga menerima `dealValue` dari client tanpa mengunci transaksi yang sudah Deal. `packageId` dan jumlah pax pada profil masih dapat diubah setelah kuota terpotong tanpa rekonsiliasi reservasi.

**Bukti:** [invoice handler](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:527), [offer handler](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:398), [dashboard cash](C:/laragon/www/crm-azhan/apps/api/src/modules/dashboard/dashboard.routes.ts:81).

**Perbaikan:** pisahkan nominal tagihan dan uang benar-benar diterima. Payment ledger hanya ditulis oleh command verifikasi/reversal; invoice draft tidak mengubah settlement. Kunci snapshot nilai, paket, dan pax booking yang sudah disahkan; revisi melalui tindakan terkontrol yang juga merekonsiliasi kuota. Nominal penawaran dihitung/ditetapkan di backend melalui kebijakan harga dan diskon.

### R02 — P1 — Approval paralel masih memotong seat berulang

`existing` dan `isNewWin` dihitung sebelum transaksi. Dua request dapat membaca prospek belum Deal, kemudian keduanya mengurangi kuota dan menaikkan `closedWonCount`. Tes dengan transaksi mock yang bahkan diserialkan menghasilkan kuota **10 → 6**, padahal satu booking dua seat seharusnya **10 → 8**.

Selain itu, pemeriksaan `quotaRemaining` kemudian update decrement merupakan dua operasi tanpa conditional predicate/locking eksplisit. Transaksi biasa saja tidak membuktikan aman terhadap overselling oleh dua prospek berbeda. Tes audit membuktikan stale-state handler pada prospek sama; skenario isolation nyata perlu integration test MySQL.

Verifikasi berikutnya juga menimpa `dpAmount` dengan satu `approvedAmount`; belum ada akumulasi pembayaran dan referensi mutasi unik. Jika field dimaksudkan saldo kumulatif, UI dan kontraknya harus eksplisit; saat ini labelnya “Nominal Dana yang Masuk ke Rekening”.

**Bukti:** [read sebelum transaksi](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:713), [pengurangan kuota](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:728), [penimpaan pembayaran](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:749).

**Perbaikan:** idempotency key dan referensi pembayaran unik, conditional state/version pada booking, kuota conditional `remaining >= required` dengan pemeriksaan jumlah row, seluruhnya dalam satu transaksi yang sesuai. Definisikan pembayaran bertahap, pembatalan, refund, dan pelepasan seat. Jangan menganggap komentar “safely against race conditions” sebagai bukti implementasi.

### R03 — P1 — Tombol kirim belum benar-benar mengirim penawaran/invoice

`sendViaWhatsApp` hanya mengatur perubahan status dan pemanggilan CAPI. Handler tidak mengirim pesan maupun membuat job pengiriman. Frontend hanya menyisipkan teks ke composer setelah request berhasil. Dengan `true`, `offerSentAt`, log terkirim, dan stage sudah berubah sebelum pesan dikirim. Dengan `false`, invoice tetap mendapatkan `invoiceSentAt`.

Dua skenario handler gagal: penawaran ditandai terkirim tanpa operasi delivery; draft invoice mendapatkan waktu terkirim. Alur pipeline juga tidak menyediakan composer melalui callback modal, sehingga “draft disisipkan” bukan jaminan ada naskah yang dapat dikirim di sana.

**Bukti:** [offer](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:395), [invoice](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:524), [modal penawaran](C:/laragon/www/crm-azhan/apps/web/src/features/chat/OfficialOfferModal.tsx:92), [modal invoice](C:/laragon/www/crm-azhan/apps/web/src/features/chat/OfficialInvoiceModal.tsx:145), [modal pipeline](C:/laragon/www/crm-azhan/apps/web/src/features/prospects/PipelinePage.tsx:575).

**Perbaikan:** persist snapshot dokumen dan intent pengiriman; stage/event dikaitkan dengan hasil kirim/messageId sesuai definisi bisnis. Pisahkan draft, issued, queued, sent, delivered, failed. Default request tanpa flag juga sekarang berarti `true`; jangan jadikan input client sebagai bukti suatu kejadian eksternal.

### R04 — P1 — Penyimpanan profil di halaman detail rusak untuk CS

`ChatProspectProfile` sudah mengirim field profil saja, tetapi `ProspectDetailPage` masih mengirim `dealValue`, `dpAmount`, dan `paymentStatus` pada setiap Save. Guard baru mengembalikan **403**, termasuk ketika CS hanya mengedit catatan. Untuk admin/finance, field finansial tidak termasuk allowlist, sehingga perubahan dapat diabaikan walaupun respons sukses.

**Bukti:** [payload detail](C:/laragon/www/crm-azhan/apps/web/src/features/prospect-detail/ProspectDetailPage.tsx:101), [guard dan allowlist](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:330). Direproduksi dengan handler asli.

**Perbaikan:** gunakan kontrak DTO profil yang sama pada seluruh frontend; hapus editor settlement dari profil umum. Validasi schema field secara eksplisit, jangan cast request langsung ke Prisma input. Tes CS menyimpan catatan di halaman detail dan panel chat harus sama-sama lolos.

### R05 — P1 — Bukti bayar privat belum bisa dipreview melalui alur frontend sekarang

Storage privat dan route autentikasi merupakan perbaikan yang benar. Tetapi URL yang disimpan relatif `/api/v1/prospects/payment-proof-file/...`, sementara FinanceVerifyModal memakainya langsung pada `<img src>`. Request gambar tidak melalui API client yang menambahkan Bearer. Pada konfigurasi Vite saat ini, `/api` juga tidak diproxy ke API; hanya `/uploads`. Mengganti origin saja belum menyelesaikan kebutuhan Authorization. PDF yang diperbolehkan backend juga tidak dapat dirender sebagai `<img>`.

Route lama `/payment-proof` masih menerima string apa pun, termasuk base64 panjang. Reproduksi handler mengembalikan 200 untuk data URL 70 ribu karakter; mock DB tidak mensimulasikan batas TEXT MySQL, tetapi membuktikan request tidak ditolak sebelum masuk persistence.

**Bukti:** [preview finance](C:/laragon/www/crm-azhan/apps/web/src/features/chat/FinanceVerifyModal.tsx:125), [route lama](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:559), [URL privat](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:650), [auth Bearer](C:/laragon/www/crm-azhan/apps/api/src/middleware/auth.ts:10), [Vite proxy](C:/laragon/www/crm-azhan/apps/web/vite.config.ts:7).

**Perbaikan:** authenticated fetch ke endpoint file dan blob URL dengan cleanup, atau mekanisme download privat yang jelas; tampilkan PDF melalui viewer/link yang sesuai. Tolak data URL di jalur lama atau ganti seluruhnya dengan attachmentId. Kaitkan attachment dengan submission/prospek dan izin dokumen, bukan hanya filename yang diketahui.

### R06 — P1 — Pengawasan semua brand belum tersambung di UI dan realtime

Backend `scopedBrandId` sudah membaca UserBrand dan memberi scope holding untuk admin/finance. Namun:

- Hook frontend masih hanya memakai activeBrandId untuk superadmin; peran lain memakai brand utama.
- Detail prospek hanya menghormati query brandId untuk superadmin. CS yang sah ditugaskan ke brand kedua bisa membaca percakapan tetapi mendapat 404 pada profil brand tersebut.
- Simpan profil panel chat dan claim masih mengirim scope secara tidak konsisten.
- Socket hanya join brand utama; room semua brand hanya untuk superadmin. Admin/finance/CS multi-brand kehilangan sebagian pembaruan langsung.
- Dashboard backend mendukung semua brand hanya untuk superadmin/finance saat brandId kosong/`all`. AppShell justru memilih brand pertama otomatis untuk superadmin; DashboardPage mengirim scope tersebut dan tidak menyediakan selector semua brand. Finance yang punya brand utama juga tetap terscope brand itu. Admin tidak memperoleh holding view.
- CRUD staf masih menerima role `admin`/`cs`, belum `finance`.

**Bukti:** [scope frontend](C:/laragon/www/crm-azhan/apps/web/src/lib/scope.ts:3), [detail endpoint](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:65), [socket room](C:/laragon/www/crm-azhan/apps/api/src/realtime/socket.ts:21), [AppShell](C:/laragon/www/crm-azhan/apps/web/src/app/AppShell.tsx:38), [dashboard frontend](C:/laragon/www/crm-azhan/apps/web/src/features/dashboard/DashboardPage.tsx:46), [role staf](C:/laragon/www/crm-azhan/apps/api/src/modules/catalog/catalog.routes.ts:450).

**Perbaikan:** satu kontrak scope holding/brand dan capability per tindakan, dipakai oleh UI, route, assignment, serta socket. Dashboard holding harus mempunyai mode eksplisit yang dapat dipilih dan menjadi default untuk pengawas yang berhak. Uji satu CS dengan dua brand, finance lintas brand, dan admin holding sampai tindakan simpan/balas/verify serta realtime.

### R07 — P1 — Filter follow-up baru salah membaca tanggal

Backend memakai `String(p.nextFollowupDate).slice(0,10)` untuk membandingkan dengan `YYYY-MM-DD`. Hasil helper livechat masih berisi Date dari Prisma; `String(Date)` menghasilkan bentuk seperti `Wed Sep 23`, bukan ISO. Tes tanggal hari ini mengembalikan **0 hasil**, padahal ada 1 prospek jatuh tempo.

Frontend pipeline memiliki filter “today” sendiri yang melakukan parsing Date; itu jalur berbeda dan tidak membetulkan endpoint baru. Pipeline juga belum mengirim query `filter=overdue/unassigned` yang baru dibuat. Menambah filter belum memenuhi next action/SLA/reminder pada A09.

**Bukti:** [filter backend](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:48), [canonical object masih Date](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:251), [filter frontend](C:/laragon/www/crm-azhan/apps/web/src/features/prospects/PipelinePage.tsx:107).

**Perbaikan:** bandingkan tanggal dengan representasi konsisten dan zona bisnis Asia/Jakarta, idealnya query range di database. Sediakan antrean tugas terlambat/hari ini/unassigned di UI, owner, dueAt, penyelesaian, dan eskalasi.

### R08 — P1 — Jalur media masih belum mempunyai batas file yang benar

Penghapusan `existingFilePath` mengurangi risiko. Namun pemeriksaan realpath memakai `startsWith(uploadsRoot)` tanpa batas separator. Path `C:\audit\uploads-other\example.png` lolos prefix `C:\audit\uploads`. Reproduksi sintetik dengan `path.win32.resolve/relative` membuktikan prefix true walaupun relative path menuju `..\uploads-other\...`; tidak membaca atau mengirim file nyata.

`flyerImage` pada metadata paket masih menerima string bebas. Dengan metadata tersebut, absolute Windows path ke sibling yang memiliki prefix dapat lolos kedua cek bila file ada. Ini lebih sempit daripada celah lama karena perlu kontrol metadata paket/file, tetapi belum memenuhi klaim “terkurung ketat”.

Media chat, termasuk dokumen masuk dari gateway, tetap disimpan di `/uploads/media` publik; perbaikan bukti bayar khusus belum menjadikan semua dokumen pribadi privat.

**Bukti:** [resolver](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:691), [metadata flyer bebas](C:/laragon/www/crm-azhan/apps/api/src/modules/catalog/catalog.routes.ts:165), [penyimpanan media](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:740), [static publik](C:/laragon/www/crm-azhan/apps/api/src/server.ts:28).

**Perbaikan:** server-generated attachmentId; realpath root dan kandidat lalu validasi containment berbasis path.relative/segment yang benar. Pisahkan flyer pemasaran publik dari media percakapan privat. Validasi file kiriman chat juga harus konsisten, bukan hanya endpoint flyer dan proof.

### R09 — P1 — Migrasi belum mengikuti schema terbaru

Hanya ada migrasi init `20260921074239_init`; enum role di SQL belum berisi finance dan enum status belum berisi contact/qualified/offer/deal/lose. Field baru seperti bukti bayar/verifikasi dan invoice juga belum ditambahkan melalui migrasi lanjutan. Typecheck memakai generated client tidak membuktikan database hasil fresh install/upgrade sesuai schema.

**Bukti:** [role SQL](C:/laragon/www/crm-azhan/apps/api/prisma/migrations/20260921074239_init/migration.sql:32), [status SQL](C:/laragon/www/crm-azhan/apps/api/prisma/migrations/20260921074239_init/migration.sql:86), [schema](C:/laragon/www/crm-azhan/apps/api/prisma/schema.prisma:150).

**Perbaikan:** inventarisasi drift, baseline/migrasi tambahan yang mempertahankan data, kemudian tes instalasi kosong dan upgrade salinan data. Jangan memakai db push ke database operasional sebagai pembuktian migrasi.

### R10 — P1 — Angka holding dan CAPI belum layak dianggap hasil transaksi final

Dashboard sudah membaca semua prospek langsung dari database, suatu kemajuan penting. Tetapi `verifiedCash` masih berasal dari `dpAmount` yang dapat ditimpa invoice (R01). Piutang dihitung `max(0, sum(dealValue)-sum(dpAmount))`: kelebihan bayar jamaah A dapat mengurangi piutang jamaah B. Contoh dua booking Rp30 juta: A membayar Rp40 juta, B Rp0; rumus menampilkan Rp20 juta, sedangkan piutang B Rp30 juta dan overpayment A Rp10 juta harus dicatat terpisah. `isWon` juga menganggap partial_dp/paid_full sebagai won meskipun stage kemudian lose; belum ada reconciliation pembatalan/refund.

CAPI masih memakai dispatch dalam proses tanpa worker durable, eventTime dari `updatedAt`, dan fallback nilai dari harga paket × semua pax ketika dealValue kosong. Test-event menerima test code opsional; payload sintetis dapat dikirim tanpa test code. Tidak ada panggilan Meta yang dilakukan pada audit ini.

**Bukti:** [dashboard](C:/laragon/www/crm-azhan/apps/api/src/modules/dashboard/dashboard.routes.ts:65), [fallback CAPI](C:/laragon/www/crm-azhan/apps/api/src/modules/capi/capi.service.ts:34), [dispatch](C:/laragon/www/crm-azhan/apps/api/src/modules/capi/capi.service.ts:111), [test-event](C:/laragon/www/crm-azhan/apps/api/src/modules/capi/capi.routes.ts:135).

**Perbaikan:** total berbasis booking/payment ledger, outstanding per booking, overpayment/refund terpisah, event Purchase dari snapshot total booking yang disetujui. Outbox persisten dengan eventId bisnis dan waktu kejadian immutable; payload sintetis wajib mempunyai test code. Tambahkan periode/cohort dan denominator opportunity sales agar kontak operasional tidak otomatis menurunkan conversion rate.

## 3. Pemetaan ulang seluruh A01–A24

“Sebagian” berarti ada subperbaikan nyata, tetapi kriteria keseluruhan belum terpenuhi. “Terbuka” berarti inti masalah masih ada; bukan klaim bahwa tidak ada satu pun perubahan file terkait. Tidak ada temuan yang ditutup penuh hanya berdasarkan nama fitur atau komentar kode.

| ID | Status | Sudah ada | Sisa yang perlu dituntaskan |
| --- | --- | --- | --- |
| A01 | Sebagian | existingFilePath dihapus; realpath dipakai | Containment prefix keliru; metadata flyer masih path/string bebas. R08. |
| A02 | Sebagian | Tombol draft dan flag send | Tidak ada pengiriman/job; sent timestamp dan CAPI mendahului send. R03. |
| A03 | Sebagian | Rekening dari brand; fallback Rp30 juta dan sejumlah benefit dihapus | Script masih hardcode deadline “besok pukul 17:00”, “sisa 4 seat”, promo gratis. DP invoice masih fallback Rp5 juta/pax. Belum ada snapshot dan validasi backend rekening/harga final. |
| A04 | Sebagian | Guard profile dan blok manual Deal | Invoice/offer masih mengubah data finansial; halaman detail CS 403. R01/R04. |
| A05 | Sebagian | Seat mengikuti quad+triple+double; shortage 409; paid_full jika nominal cukup | Belum idempotent/aman paralel, ledger, akumulasi pembayaran, reservation/release. R02. |
| A06 | Sebagian | Storage proof privat dan endpoint upload | Preview belum kompatibel auth/origin; route lama menerima base64. R05. |
| A07 | Sebagian | Scope middleware dan katalog mengenal UserBrand/holding | Hook, detail route, payload, socket dan CRUD finance belum konsisten. R06. |
| A08 | Sebagian | Endpoint assign/handover beserta log | Belum ada pemanggil frontend assign/handover prospek; target hanya dicek aktif, belum role/akses brand. Auto-claim kirim masih balapan; distribusi masih brand utama dan pengecualian status legacy; deaktivasi staf belum menghasilkan handover. |
| A09 | Sebagian | Filter backend ditambahkan; follow-up pipeline membawa brandId | Bug Date R07; UI belum lengkap; belum task jam/SLA/escalation; lastFollowupAt hanya berubah jika tanggal berikutnya diisi. |
| A10 | Sebagian | API history tidak lagi mensyaratkan connected; helper mendukung offline; dashboard langsung DB | Inbox masih mengosongkan selected/list dan menonaktifkan query pesan saat disconnected. Pipeline masih hanya prospek dengan pesan livechat; lead offline belum lengkap. |
| A11 | Terbuka | Belum ditemukan outbox/replay persisten | Send eksternal mendahului chatMessage.create; echo upsert dapat datang dahulu; gateway notify gagal hanya warning; receipt tanpa row belum direplay. |
| A12 | Sebagian | QueryClient dibersihkan saat logout | HTTP refresh belum single-flight; socket token hanya saat effect user; belum resync reconnect/revocation socket. |
| A13 | Terbuka | Nilai positif dealValue memang diprioritaskan | Fallback, waktu event, identitas transaksi, durability, test code masih bermasalah. R10. |
| A14 | Sebagian | Endpoint holding, pax, cash, outstanding, per-brand, status channel | UI semua brand belum tersambung; kas/piutang tidak terjamin; belum cohort/periode/CS/action queues. R06/R10. |
| A15 | Terbuka | Prospect masih model utama | Belum Customer–Opportunity–Booking–Payment terpisah; repeat booking dan keluarga masih rentan overwrite. |
| A16 | Terbuka | Beberapa guard ada di route | canTransitionStatus tetap selalu true; action routes bisa menurunkan Deal ke offer/closing; Kanban mencocokkan literal stage; belum mapping legacy/transition service. |
| A17 | Sebagian | Route `/catalog/packages`, brandId follow-up, listener finance/quota/whatsapp sudah dibetulkan | Belum antrean verifikasi durable dan E2E kontrak per role; event baru tidak mengatasi room brand yang salah. |
| A18 | Sebagian | Dirty-state dan reset per prospect pada panel chat | Halaman detail masih reset setiap refetch; datetime-local diisi UTC lalu dianggap lokal/WIB; audit fokus dialog/autoscroll belum ditutup. |
| A19 | Terbuka | Belum ditemukan pagination history/inbox | Semua prospek/history masih dibaca; invalidasi banyak query; dashboard agregasi in-memory seluruh prospek. |
| A20 | Sebagian | Signature/size check flyer dan proof; proof privat | Media chat publik dan validasi media belum setara; akses proof belum melalui attachment association. R08/R05. |
| A21 | Sebagian | Brand berprospek/berpaket ditolak delete; paket berprospek diarsip | Staf masih hard delete; belum archive brand/staf dan snapshot aktor historis; guard count dan delete belum satu mekanisme konsistensi. |
| A22 | Sebagian | Typecheck bersih, 29 tes lulus | Migration drift; tes baru menyalin logic dan tidak membuktikan role/route/race. R09 dan bagian 1. |
| A23 | Terbuka | Liveness proses dan restore sesi gateway ada | Belum bukti readiness dependency, event backlog durable, correlation, backup/restore data+media teruji, graceful shutdown. Restore sesi WA bukan bukti restore CRM. |
| A24 | Terbuka | Materi LMS dan template tersedia | Progress tetap localStorage satu key; belum progress per staf di server/coaching/outcome tracking. |

Rujukan tambahan untuk baris matriks:

- A03: [variabel skrip](C:/laragon/www/crm-azhan/apps/api/src/modules/scripts/scripts.routes.ts:178), [DP fallback](C:/laragon/www/crm-azhan/apps/web/src/features/chat/OfficialInvoiceModal.tsx:55).
- A08: [target assign](C:/laragon/www/crm-azhan/apps/api/src/modules/prospects/prospects.routes.ts:242), [deaktivasi staf](C:/laragon/www/crm-azhan/apps/api/src/modules/catalog/catalog.routes.ts:539), [distribusi](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:1147), [auto-claim](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:597).
- A10: [selected berdasarkan koneksi](C:/laragon/www/crm-azhan/apps/web/src/features/chat/InboxPage.tsx:318), [query pesan](C:/laragon/www/crm-azhan/apps/web/src/features/chat/InboxPage.tsx:401), [list offline](C:/laragon/www/crm-azhan/apps/web/src/features/chat/InboxPage.tsx:523).
- A11: [persistence sesudah send](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:576), [gateway notify](C:/laragon/www/crm-azhan/apps/wa-gateway/src/server.ts:37).
- A12: [refresh HTTP](C:/laragon/www/crm-azhan/apps/web/src/lib/api.ts:14), [socket frontend](C:/laragon/www/crm-azhan/apps/web/src/app/socket.tsx:10).
- A16: [transition](C:/laragon/www/crm-azhan/packages/shared-types/src/business.ts:3), [Kanban](C:/laragon/www/crm-azhan/apps/web/src/features/prospects/PipelinePage.tsx:404).
- A18: [detail effect](C:/laragon/www/crm-azhan/apps/web/src/features/prospect-detail/ProspectDetailPage.tsx:60), [invoice date](C:/laragon/www/crm-azhan/apps/web/src/features/chat/OfficialInvoiceModal.tsx:62).
- A19: [list prospects/messages](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:152), [full history](C:/laragon/www/crm-azhan/apps/api/src/modules/chat/chat.routes.ts:344).
- A21: [delete staf](C:/laragon/www/crm-azhan/apps/api/src/modules/catalog/catalog.routes.ts:656).
- A23: [health API](C:/laragon/www/crm-azhan/apps/api/src/server.ts:30), [gateway notification](C:/laragon/www/crm-azhan/apps/wa-gateway/src/server.ts:37).
- A24: [LMS localStorage](C:/laragon/www/crm-azhan/apps/web/src/features/lms/LmsPage.tsx:11).

## 4. Urutan perbaikan yang disarankan

1. **Integritas transaksi dan regresi operasional:** R01–R05, filter tanggal R07, containment/media R08, serta migrasi R09. Pastikan invoice tidak mengubah kas, approval idempotent, pesan tidak dicatat terkirim tanpa bukti, profil CS dapat disimpan, dan finance dapat melihat bukti bayar.
2. **Operasional holding:** R06, frontend assignment/handover, penanganan CS nonaktif, inbox offline, task/SLA. Pengawas harus dapat memilih semua brand, melakukan drill-down, dan menerima update yang sama konsistennya dengan CS.
3. **Keandalan pesan dan angka growth:** outbound/inbound outbox/reconciliation, CAPI durable dari booking, dashboard berbasis ledger dan cohort. Jangan menggunakan perubahan status yang dapat diulang sebagai transaksi revenue baru.
4. **Scale dan coaching:** Customer/Opportunity terpisah, pagination, observability/restore, LMS per staf dan evaluasi template.

## 5. Kriteria penutupan revisi berikutnya

| Skenario | Hasil wajib |
| --- | --- |
| CS edit catatan dari detail dan panel chat | Keduanya sukses; tidak ada perubahan keuangan |
| CS draft invoice setelah DP Finance Rp5 juta | Kas tetap Rp5 juta; nominal tagihan tercatat terpisah |
| Dua approval identik bersamaan | Satu pembayaran/kemenangan; seat terpotong sekali |
| Dua keluarga berebut seat terakhir | Hanya booking dengan kuota tersedia yang sukses; tidak negatif |
| DP lalu pelunasan | Total pembayaran dan sisa tagihan dapat direkonsiliasi; event Purchase tidak berganda |
| Draft/send gagal | Tidak ada sent timestamp atau stage berbasis send palsu; retry aman |
| Upload/preview proof gambar dan PDF | Dapat dibaca finance berizin; URL publik/anonim tidak membuka dokumen |
| CS mendapat brand A+B | Inbox/detail/save/claim/realtime konsisten pada A dan B |
| Pengawas holding masuk dashboard | Semua brand bisa dipilih secara eksplisit; total cocok dengan rincian |
| Today/overdue lintas pergantian hari WIB | Antrean benar dan dapat dikerjakan lewat UI |
| WA disconnect/reconnect/API restart | History tetap bisa dibaca; pesan/event tertunda direkonsiliasi |
| Fresh database dan upgrade copy | Migrasi menghasilkan schema sesuai; tes bisnis dijalankan pada DB terisolasi |

Perbaikan yang sudah masuk layak dipertahankan. Akan tetapi, sampai skenario kritis ini terverifikasi, label yang akurat adalah **perbaikan parsial dengan temuan P1 terbuka**, bukan “seluruh temuan selesai”.
