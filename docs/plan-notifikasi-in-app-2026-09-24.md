# Rencana Implementasi Notifikasi In-App — 24 September 2026

Status: **F0–F3 selesai (24/09)**; F4 (Web Push, opsional) belum. Lihat bagian 12. Keputusan yang perlu dikonfirmasi ada di bagian 11.

## 1. Tujuan dan batasan

**Tujuan:** setiap orang (CS, Finance, Admin, Superadmin) langsung tahu hal yang **perlu ia tindak lanjuti**, tanpa harus memantau Inbox, Pipeline, atau Verifikasi terus-menerus. Notifikasi juga tetap tersedia setelah ia offline atau berpindah tab.

**Termasuk:**
- lonceng dengan jumlah belum dibaca di header;
- panel daftar notifikasi;
- toast untuk yang mendesak;
- halaman preferensi;
- notifikasi terjadwal (SLA balasan, follow-up, invoice, verifikasi).

**Tidak termasuk (fase opsional F4):**
- Web Push / notifikasi browser saat aplikasi tertutup;
- email;
- pesan WhatsApp ke staf.

**Prinsip:**
1. **Notifikasi ≠ event refresh.** Event socket yang ada (`prospect:updated`, `message:new`, dan lainnya) tetap dipakai untuk menyegarkan data. Notifikasi hanya untuk kejadian yang relevan bagi **penerima tertentu**.
2. **Tersimpan per penerima.** Notifikasi disimpan di database, lalu dikirim realtime ke room user. Bila user offline, notifikasi tetap ada saat ia kembali.
3. **Tidak memberi tahu pelaku atas tindakannya sendiri.**
4. **Diringkas, bukan dibanjiri.** Kejadian sejenis pada objek yang sama digabung, misalnya "3 bukti transfer baru menunggu verifikasi".
5. **Selesai sendiri.** Notifikasi kondisi hilang dari "Perlu tindakan" saat kondisinya selesai, misalnya sudah dibalas atau sudah diverifikasi.
6. **Hak akses dicek ulang saat dikirim.** Penerima harus masih aktif dan masih punya akses ke brand tersebut.

## 2. Kondisi sekarang (dari kode)

| Aspek | Kondisi | Lokasi |
| --- | --- | --- |
| Socket rooms | `brand:<id>` dan `holding`; **belum ada room per user** | `apps/api/src/realtime/socket.ts` |
| Event yang dipancarkan | `prospect:updated` (14×), `prospect:claimed` (8×), `message:new`, `message:status`, `finance:payment_proof_new`, `whatsapp:status`, `package:quota_updated`, dan lainnya. Klien hanya me-*invalidate* query. | `apps/web/src/app/socket.tsx` |
| Tabel notifikasi | Tidak ada | `apps/api/prisma/schema.prisma` |
| Scheduler / job berkala | Tidak ada. Satu proses API (`server.ts`). | — |
| Toast | Lokal per halaman (`useToast`/`showToast` di Pipeline, Inbox, Staff, dan lainnya); belum ada toast global | beberapa file |
| Header | Tempat lonceng tersedia di header AppShell | `apps/web/src/app/AppShell.tsx:359` |
| Role | `superadmin`, `admin`, `cs`, `finance` | enum `Role` |
| Celah alur | **Belum ada penolakan bukti transfer**: Finance hanya bisa memverifikasi | `prospects.routes.ts` (`verify-payment`) |

## 3. Katalog notifikasi per role

Prioritas: **Mendesak** (toast dan lencana merah), **Tindakan** (toast biasa), **Info** (hanya daftar).

### CS

| Kode | Kapan | Penerima | Prioritas | Tautan | Selesai sendiri bila |
| --- | --- | --- | --- | --- | --- |
| `lead.assigned` | Lead baru ditetapkan otomatis ke CS | PIC baru | Tindakan | Inbox prospek | PIC membalas |
| `pic.assigned` | Admin menugaskan prospek ke CS | PIC baru | Tindakan | Inbox | — |
| `pic.handover_received` | CS lain menyerahkan prospek ke saya (dengan alasan) | PIC baru | Tindakan | Inbox | — |
| `pic.taken_over` | Prospek saya diambil alih CS lain (15 menit tidak dibalas) | PIC lama | Mendesak | Detail prospek | — |
| `pic.released` | Prospek saya dilepas Admin ke antrean | PIC lama | Info | Pipeline | — |
| `reply.sla_warning` | Jamaah menunggu **10 menit** (5 menit sebelum bisa diambil alih) | PIC | Mendesak | Inbox | PIC membalas |
| `reply.takeover_open` | Ada prospek brand yang bisa diambil alih (lebih dari 15 menit) | CS lain di brand, **diringkas per brand** | Tindakan | Pipeline `?quick=reply` | Semua sudah dibalas |
| `message.inbound` | Pesan baru dari jamaah milik saya, **tidak ditampilkan saat chat itu sedang dibuka** | PIC | Info (toast opsional) | Inbox | Chat dibaca |
| `followup.due_today` | Ringkasan pukul 08.00 WIB: follow-up hari ini | PIC | Tindakan | Pipeline `?quick=today&pic=mine` | — |
| `followup.overdue` | Follow-up terlambat (ringkasan harian) | PIC | Tindakan | Pipeline `?quick=overdue&pic=mine` | Tanggal diperbarui |
| `invoice.overdue` | Invoice lewat jatuh tempo tanpa pembayaran terverifikasi | PIC | Tindakan | Detail prospek | Pembayaran terverifikasi |
| `payment.verified` | Finance memverifikasi pembayaran prospek saya (DP/lunas; Deal) | PIC | Info | Detail prospek | — |
| `payment.rejected` | Bukti transfer ditolak Finance (**butuh alur tolak baru, lihat F2**) | PIC | Mendesak | Detail prospek | Bukti baru diunggah |
| `booking.cancelled` | Booking Deal milik saya dibatalkan Finance/Admin | PIC | Tindakan | Detail prospek | — |
| `package.quota_low` | Kuota paket yang sedang saya tawarkan tinggal ≤ 5 seat atau habis | PIC dari prospek terbuka di paket itu | Tindakan | Paket | Kuota ditambah |

### Finance

| Kode | Kapan | Penerima | Prioritas | Tautan | Selesai sendiri bila |
| --- | --- | --- | --- | --- | --- |
| `payment.proof_new` | Bukti transfer baru (unggah atau dari chat), **diringkas** | Semua Finance aktif | Tindakan | `/verifikasi` | Antrean kosong |
| `payment.proof_stale` | Bukti menunggu lebih dari **2 jam kerja** | Finance, lalu Admin bila lebih dari 1 hari | Mendesak | `/verifikasi` | Diverifikasi/ditolak |
| `payment.overpaid` | Verifikasi membuat kas melebihi nilai booking | Finance (pelaku tidak) dan Admin | Tindakan | Detail prospek | — |
| `refund.needed` | Booking Deal dibatalkan dan ada kas terverifikasi | Finance | Mendesak | Detail prospek | Refund dicatat (alur masa depan) |
| `invoice.overdue_digest` | Ringkasan harian invoice lewat tempo per brand | Finance | Info | Pipeline `?quick=…` | — |

### Admin

| Kode | Kapan | Penerima | Prioritas | Tautan | Selesai sendiri bila |
| --- | --- | --- | --- | --- | --- |
| `wa.disconnected` | Perangkat WA brand terputus lebih dari 2 menit (disaring agar kedipan singkat tidak memicu) | Admin brand dan Superadmin | Mendesak | `/devices/:brandId` | Tersambung lagi (mengirim `wa.reconnected` sebagai info) |
| `lead.unassigned` | Lead baru tanpa PIC (tidak ada CS aktif) atau antrean "Belum ada PIC" lebih dari 30 menit | Admin brand | Mendesak | Pipeline `?pic=none` | Diklaim/ditugaskan |
| `reply.escalation` | Jamaah belum dibalas **30 menit** (setelah takeover terbuka tidak dimanfaatkan) | Admin brand | Mendesak | Inbox | Dibalas |
| `pic.taken_over_digest` | Ringkasan harian pengambilalihan per CS (bahan coaching) | Admin brand | Info | Staff/Laporan | — |
| `staff.prospects_released` | Prospek dilepas karena staf dinonaktifkan atau dicabut aksesnya (oleh admin lain) | Admin brand selain pelaku | Info | Pipeline `?pic=none` | — |
| `package.quota_empty` | Kuota paket habis | Admin brand | Tindakan | Paket | Kuota ditambah |
| `capi.failed` | Event Meta CAPI gagal, **diringkas per jam** | Admin dan Superadmin | Info | `/meta-capi` | — |

### Superadmin

Menerima semua notifikasi Admin untuk **semua brand**, ditambah:
- `system.gateway_down`: gateway WA tidak merespons;
- `brand.no_active_cs`: brand tanpa CS aktif.

## 4. Arsitektur backend

### 4.1 Model data (Prisma, MySQL)

```prisma
enum NotificationPriority { info action urgent }

model Notification {
  id          Int                  @id @default(autoincrement())
  userId      Int                  @map("user_id")          // penerima
  brandId     Int?                 @map("brand_id")
  type        String               @db.VarChar(50)          // mis. "reply.sla_warning"
  priority    NotificationPriority @default(info)
  title       String               @db.VarChar(200)
  body        String?              @db.VarChar(500)
  link        String?              @db.VarChar(300)         // path relatif aplikasi, divalidasi
  entityType  String?              @map("entity_type") @db.VarChar(30)   // prospect | package | device | brand
  entityId    Int?                 @map("entity_id")
  actorId     Int?                 @map("actor_id")
  count       Int                  @default(1)              // jumlah kejadian yang diringkas
  // Kunci ringkasan: satu baris AKTIF per (penerima, activeKey). Dikosongkan saat dibaca/selesai,
  // sehingga kejadian berikutnya membuat baris baru. MySQL mengizinkan banyak NULL pada unique.
  activeKey   String?              @map("active_key") @db.VarChar(150)
  readAt      DateTime?            @map("read_at")
  resolvedAt  DateTime?            @map("resolved_at")
  createdAt   DateTime             @default(now()) @map("created_at")
  updatedAt   DateTime             @updatedAt @map("updated_at")
  user        User                 @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, activeKey])
  @@index([userId, readAt, createdAt])
  @@index([entityType, entityId, resolvedAt])
  @@map("notifications")
}

model NotificationPreference {
  userId  Int     @map("user_id")
  type    String  @db.VarChar(50)
  toast   Boolean @default(true)   // daftar selalu aktif; notifikasi Mendesak tidak bisa dimatikan
  sound   Boolean @default(false)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, type])
  @@map("notification_preferences")
}

// Kunci sekali-kirim untuk notifikasi terjadwal (satu episode menunggu = satu notifikasi).
model NotificationDedupe {
  key       String   @id @db.VarChar(191)   // mis. "reply.sla_warning:p123:1727150000"
  createdAt DateTime @default(now()) @map("created_at")
  @@map("notification_dedupes")
}
```

**Retensi:** notifikasi yang sudah dibaca dihapus setelah 60 hari, yang belum dibaca setelah 180 hari, dan kunci dedupe setelah 14 hari. Penghapusan dijalankan sebagai job harian.

### 4.2 Layanan `notify` — `apps/api/src/modules/notifications/notify.service.ts`

```ts
notify({
  type, priority, brandId, actorId,
  recipients: Recipient,               // lihat resolver
  title, body, link, entity: { type, id },
  activeKey?,                          // untuk meringkas: "proof_new:brand:3"
  dedupeKey?,                          // untuk sekali-kirim (job terjadwal)
})
resolveNotifications({ entityType, entityId, types })   // tandai resolvedAt + kosongkan activeKey
```

**Penerima** (`recipients.ts`) dihitung saat pengiriman dan selalu menyaring user aktif dengan akses brand:
- `picOf(prospect)`;
- `csOfBrand(brandId, { exclude })` (brand utama dan UserBrand, sama dengan `picCandidates`);
- `financeUsers()` (lingkup holding);
- `adminsOf(brandId)` (admin dengan brand terkait, fallback semua admin);
- `superadmins()`.

**Alur `notify`:**
1. Resolusi penerima; keluarkan `actorId`.
2. Bila `dedupeKey` sudah ada, berhenti. Bila belum, insert dedupe (unik = aman dari balapan).
3. Per penerima: bila `activeKey` ada, lakukan *upsert* baris aktif (`count + 1`, perbarui judul/isi/`updatedAt`); bila tidak, insert baru.
4. **Setelah transaksi bisnis commit**, emit `notification:new` ke room `user:<id>` beserta ringkasan `{ id, type, priority, title, link, unreadCount }`.

Transaksi bisnis tidak boleh gagal karena notifikasi gagal. `notify` dipanggil setelah commit, dan kegagalannya hanya dicatat di log.

**Titik panggil** (event transaksional, F1):

| Sumber | Notifikasi |
| --- | --- |
| `chat.routes.ts` auto-assign lead baru | `lead.assigned` / `lead.unassigned` |
| `chat.routes.ts` pesan masuk | `message.inbound` (diringkas per prospek) |
| `outbound.ts` balasan terkirim | `resolveNotifications` untuk `reply.*` dan `lead.assigned` |
| `prospects.routes.ts` assign / handover / takeover | `pic.*` |
| `pic.ts releaseProspectsOf` | `pic.released`, `staff.prospects_released` |
| `recordPaymentProof` | `payment.proof_new` |
| `verify-payment` | `payment.verified`, `payment.overpaid`, resolve `payment.proof_*` |
| `PATCH /status` pembatalan Deal | `booking.cancelled`, `refund.needed` |
| `internalRouter /wa/status` | `wa.disconnected` (tertunda 2 menit) dan `wa.reconnected` |
| verifikasi (pengurangan kuota) | `package.quota_low` / `quota_empty` |
| `capi.service.ts` gagal | `capi.failed` (diringkas per jam) |

### 4.3 Socket

Di `socket.ts`, tambahkan `socket.join(\`user:${user.id}\`)` dan fungsi `emitToUser(userId, event, payload)`.

Event:
- `notification:new`;
- `notification:updated` (hitungan ringkasan bertambah);
- `notification:read` (sinkron antar tab/perangkat user yang sama).

### 4.4 Scheduler (F2)

Belum ada job berkala, jadi tambahkan `apps/api/src/jobs/scheduler.ts` yang dimulai dari `server.ts`:
- jalan tiap **60 detik**;
- memakai kunci MySQL `GET_LOCK('crm_scheduler', 0)` agar aman bila kelak ada lebih dari satu proses API;
- dimatikan dengan `SCHEDULER_ENABLED=false` (untuk tes dan dev).

| Job | Frekuensi | Logika | Dedupe |
| --- | --- | --- | --- |
| Balasan tertunda | 60 detik | Prospek terbuka ber-PIC dengan `firstUnansweredAt` ≥ 10/15/30 menit mengirim `reply.sla_warning` / `reply.takeover_open` / `reply.escalation` | `type:p<id>:<awaitingSince>` |
| Lead tanpa PIC | 5 menit | `userId = null`, terbuka, lebih dari 30 menit sejak dibuat | `lead.unassigned:p<id>` |
| WA terputus | 60 detik | `WhatsappSession.status != connected` selama lebih dari 2 menit | `wa.disconnected:b<id>:<since>` |
| Bukti menunggu | 15 menit | Bukti belum diverifikasi lebih dari 2 jam kerja / 1 hari | `payment.proof_stale:p<id>:<proofAt>:<level>` |
| Follow-up | 08.00 WIB | Ringkasan per CS: hari ini + terlambat | `followup:u<id>:<tanggal>` |
| Invoice lewat | 08.00 WIB | `status=closing`, `invoiceDueAt < now` | `invoice.overdue:p<id>:<dueAt>` |
| Ringkasan admin | 17.00 WIB | Takeover dan invoice lewat per brand | `digest:u<id>:<tanggal>` |
| Retensi | 03.00 WIB | Hapus notifikasi dan dedupe lama | — |

Query SLA balasan memakai pesan terakhir per prospek. Indeks `ChatMessage(prospectId, timestamp)` sudah ada. Batasi hanya prospek terbuka ber-PIC yang pesan terakhirnya dari jamaah.

### 4.5 REST API — `/api/v1/notifications`

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/` | Daftar milik user: `?filter=all\|unread\|action&cursor=<id>&limit=20` (cursor pagination) |
| GET | `/unread-count` | `{ total, urgent }` untuk lencana |
| POST | `/:id/read` | Tandai dibaca (hanya milik sendiri; 404 bila bukan) |
| POST | `/read-all` | Tandai semua dibaca (opsional `?type=`) |
| GET/PUT | `/preferences` | Preferensi toast/suara per tipe |

Semua query dibatasi `userId = req.user.id`. Tidak ada endpoint yang membaca notifikasi user lain.

### 4.6 Keamanan dan privasi

- `link` hanya path internal yang diawali `/`, divalidasi di server. Tidak ada URL eksternal.
- Isi notifikasi memakai nama jamaah, bukan nomor telepon, dan tidak memuat isi pesan chat lengkap (maksimal 80 karakter pratinjau untuk `message.inbound`).
- Saat membuka tautan, halaman tujuan tetap memeriksa hak akses seperti biasa. Notifikasi tidak memberi akses tambahan.

## 5. Frontend

| Komponen | Isi |
| --- | --- |
| `NotificationBell` di header AppShell | Ikon lonceng dengan lencana jumlah belum dibaca (merah bila ada Mendesak), `aria-label="Notifikasi, 3 belum dibaca"` |
| `NotificationPanel` (Radix Popover; lembar penuh di mobile) | Tab **Perlu tindakan** / **Semua**; item: ikon tipe, judul, isi singkat, waktu relatif, penanda belum dibaca; klik membuka tautan dan menandai dibaca; tombol "Tandai semua dibaca"; infinite scroll |
| Toast global (`app/toast.tsx`) | Menggantikan pola toast lokal secara bertahap. `aria-live="polite"`, dan `assertive` untuk Mendesak. Maksimal 3 bertumpuk. Mendesak tetap tampil sampai ditutup. |
| `SocketBridge` | `notification:new` meng-*invalidate* `['notifications']` dan menampilkan toast sesuai preferensi. Toast ditekan bila user sedang melihat objeknya (mis. chat prospek yang sama terbuka). |
| Judul tab | `(3) CRM AZHAN` saat ada notifikasi belum dibaca |
| Halaman Preferensi (`/pengaturan/notifikasi`) | Tabel per tipe yang relevan dengan role: toast on/off dan suara on/off. Tipe Mendesak terkunci. |
| Suara (opsional) | Satu bunyi pendek, hanya bila diizinkan preferensi dan tab aktif |

Aturan desain proyek tetap berlaku: palet monokrom, tidak memakai `<select>` native, dan layout tetap nyaman di split-screen sekitar 700 px.

## 6. Pengujian

- **Unit (API):**
  - resolver penerima (aktif, akses brand, pelaku dikeluarkan);
  - ringkasan `activeKey` (count bertambah, baris baru setelah dibaca);
  - dedupe (dua sweep paralel menghasilkan satu notifikasi);
  - `resolveNotifications`.
- **Route:** daftar/hitungan/tandai dibaca hanya untuk milik sendiri; validasi `link`.
- **Job:** waktu dipalsukan (`vi.setSystemTime`), untuk ambang 10/15/30 menit, jadwal 08.00 WIB, dan tidak mengirim ulang pada episode yang sama.
- **Integrasi titik panggil:** tiap sumber pada 4.2 menghasilkan tipe dan penerima yang benar, dan tidak mengirim ke pelaku.
- **Web:**
  - lencana dan panel;
  - klik membuka tautan dan menandai dibaca;
  - toast Mendesak tidak hilang sendiri;
  - toast ditekan saat chat yang sama terbuka;
  - preferensi.
- **Beban:** 50 CS × 500 prospek terbuka; sweep SLA di bawah 200 ms dengan indeks.

## 7. Fase dan estimasi

| Fase | Isi | Estimasi | Selesai bila |
| --- | --- | --- | --- |
| **F0 Fondasi** | Model dan migrasi, `notify`/resolver/`resolveNotifications`, room `user:<id>`, REST, lonceng dan panel, toast global | 3–4 hari | Notifikasi uji muncul realtime dan tersimpan; tes unit dan route lulus |
| **F1 Event transaksional** | Semua titik panggil di 4.2 kecuali yang terjadwal; `message.inbound` dengan penekanan | 3 hari | Setiap role menerima notifikasi pada skenario katalog; tidak ada notifikasi ke pelaku |
| **F2 Terjadwal dan SLA** | Scheduler dan job di 4.4; **alur tolak bukti transfer** (endpoint, modal Finance, notifikasi `payment.rejected`) | 4 hari | SLA 10/15/30 menit berjalan; ringkasan 08.00 WIB; tes waktu lulus |
| **F3 Preferensi dan kerapian** | Halaman preferensi, suara, judul tab, ringkasan admin, retensi, migrasi toast lokal ke global | 2–3 hari | Preferensi dihormati; retensi berjalan |
| **F4 (opsional) Web Push** | Service worker, VAPID, izin browser, kirim untuk Mendesak saat tab tertutup | 3 hari | Notifikasi Mendesak sampai saat aplikasi tidak terbuka |

Total F0–F3: sekitar **12–14 hari kerja**.

## 8. Migrasi dan peluncuran

- **Migrasi Prisma baru** (`notifications`, `notification_preferences`, `notification_dedupes`).
  - DB lokal pernah di-`db push` dan dua migrasi ditandai `migrate resolve`.
  - Sebelum migrasi: backup (`scratch/db-backup/`), lalu `prisma migrate dev --create-only`, tinjau SQL-nya, dan jalankan.
  - Jalankan `pnpm db:generate` setelah stack dimatikan (engine DLL terkunci saat API hidup).
- **Flag** `NOTIFICATIONS_ENABLED` dan `SCHEDULER_ENABLED` agar bisa diaktifkan bertahap per lingkungan.
- **Urutan rilis:**
  1. F0 dan F1 dulu, dengan scheduler mati;
  2. amati volume selama beberapa hari;
  3. aktifkan scheduler (F2).
- **Telemetri sederhana:** jumlah notifikasi per tipe per hari dan rasio dibaca, untuk menyetel ambang dan ringkasan.

## 9. Risiko

| Risiko | Mitigasi |
| --- | --- |
| Kebisingan: CS kewalahan dan mengabaikan lonceng | Ringkasan per `activeKey`; `message.inbound` hanya Info dan ditekan saat chat terbuka; preferensi toast; telemetri |
| Notifikasi ganda dari sweep paralel atau restart | `NotificationDedupe` unik dan `GET_LOCK` |
| Notifikasi basi (kondisi sudah selesai) | `resolveNotifications` di titik balasan, verifikasi, dan klaim; job memeriksa ulang kondisi sebelum mengirim |
| Status WA berkedip | Ambang 2 menit sebelum `wa.disconnected` |
| Transaksi bisnis terganggu | `notify` setelah commit, gagal diam (dicatat) |
| Kebocoran lintas brand | Resolver menyaring akses brand saat pengiriman; REST hanya milik sendiri |

## 10. Dampak ke kode yang ada

**Baru:**
- `modules/notifications/` (service, resolver, routes, tes);
- `jobs/scheduler.ts`;
- web `features/notifications/` (bell, panel, preferensi) dan `app/toast.tsx`.

**Diubah:**
- `socket.ts` (room user);
- `server.ts` (router dan scheduler);
- titik panggil pada 4.2;
- `socket.tsx` (listener);
- `AppShell.tsx` (lonceng);
- `App.tsx` (rute preferensi).

## 11. Keputusan yang perlu dikonfirmasi

1. **Ambang SLA balasan:** peringatan 10 menit ke PIC, 15 menit (takeover) ke CS lain, eskalasi 30 menit ke Admin. Sesuai?
2. **Jam kerja:** apakah SLA dan "2 jam kerja" hanya dihitung pada jam operasional (mis. 08.00–21.00 WIB)? Bila ya, jamnya berapa dan apakah hari Minggu/libur dikecualikan?
3. **Notifikasi takeover ke CS lain:** kirim ke semua CS brand (diringkas) atau hanya CS dengan beban paling ringan?
4. **Pesan masuk (`message.inbound`):** tampilkan toast secara default atau hanya di daftar?
5. **Admin:** apakah Admin lingkup holding (semua brand) atau per brand? Ini menentukan penerima notifikasi Admin.
6. **Alur tolak bukti transfer:** setuju dimasukkan ke F2? (Dibutuhkan agar CS tahu bukti ditolak.)
7. **Web Push (F4):** perlu atau cukup in-app?

## 12. Status implementasi

### F0 — Fondasi (selesai)

- **Model dan migrasi:** `notifications`, `notification_preferences`, `notification_dedupes`, di `prisma/migrations/20260924100000_in_app_notifications`. Migrasi **belum dijalankan** ke DB lokal.
- **Layanan:**
  - `modules/notifications/notify.service.ts`: `notify`, `resolveNotifications`, `safeLink`. Tidak pernah melempar error, dan ringkasan `activeKey` aman dari balapan (P2002).
  - `recipients.ts`: `picOf`, `csOfBrand`, `financeUsers`, `adminsOf`.
  - `notification.events.ts`: satu fungsi per kejadian, dijalankan lewat `dispatch()` di latar belakang.
- **Socket:** room `user:<id>` dan `emitToUser`. Event `notification:new`, `notification:updated`, `notification:read`.
- **REST `/api/v1/notifications`:** `GET /` (filter `all|unread|action`, cursor), `GET /unread-count`, `POST /:id/read`, `POST /read-all`. Semuanya dibatasi pada milik sendiri.
- **Flag:** `NOTIFICATIONS_ENABLED` (default `true`).
- **Web:**
  - `NotificationBell` dipasang di rail sidebar (desktop, termasuk Inbox) dan di header (layar kecil); panel "Perlu tindakan" / "Semua".
  - Toast global (`app/toast.tsx`): mendesak tetap tampil sampai ditutup, lainnya hilang dalam 6 detik, maksimal 3.
  - Toast ditekan bila halaman tujuannya sedang dibuka.

### F1 — Event transaksional (selesai)

| Kejadian | Notifikasi |
| --- | --- |
| Lead baru dari WA (realtime saja, bukan impor riwayat) | `lead.assigned` ke PIC otomatis, atau `lead.unassigned` ke Admin bila tidak ada CS |
| Pesan jamaah (bukan kiriman ulang gateway) | `message.inbound` ke PIC, diringkas per prospek |
| Balasan dari aplikasi / HP / media | Menutup `message.inbound` dan `lead.assigned`; chat dibuka menutup `message.inbound` milik pembaca |
| Klaim (tombol / balas pertama) | Menutup `lead.unassigned` |
| Tugaskan / Serahkan / Ambil alih | `pic.assigned`, `pic.handover_received`, `pic.taken_over` (mendesak), `pic.released` |
| Staf dinonaktifkan / dicabut aksesnya / dihapus | `staff.prospects_released` ke Admin lain |
| Bukti transfer diajukan | `payment.proof_new` ke Finance, **per prospek** (bukan satu ringkasan global) agar bisa selesai sendiri saat prospek itu diverifikasi |
| Verifikasi pembayaran | `payment.verified` ke PIC, `payment.overpaid` ke Finance dan Admin, `package.quota_low` / `quota_empty` |
| Pembatalan booking Deal | `booking.cancelled` ke PIC, `refund.needed` ke Finance bila ada kas |
| Perangkat WA | `wa.disconnected` setelah 2 menit tidak tersambung (timer di proses API) dan `wa.reconnected` |
| Meta CAPI gagal | `capi.failed` ke Admin, diringkas per brand |

**Tes:**
- API: 90/90 (21 tes baru: layanan inti, events, routes, dan pemicu dari route prospek).
- Web: 35/35 (4 tes baru: lonceng, panel, Escape/fokus, toast).

**Catatan:**
- Di layar kecil pada halaman Inbox (tanpa header), lonceng belum tampil. Toast tetap muncul.
- Timer `wa.disconnected` hidup di memori proses: bila API restart dalam 2 menit itu, notifikasi terputus baru muncul saat status dilaporkan lagi. Scheduler di F2 akan menutup celah ini.

### F2 — Terjadwal, SLA, dan penolakan bukti (selesai)

**Scheduler** (`src/jobs/scheduler.ts`), dimulai dari `server.ts`:
- berjalan tiap 60 detik;
- satu putaran per menit lintas proses, lewat kunci `scheduler:tick:<menit>` di `notification_dedupes`, sehingga tidak perlu `GET_LOCK`;
- job harian jalan sekali per tanggal WIB setelah jamnya tiba, dan tetap menyusul bila API baru dinyalakan;
- dimatikan dengan `SCHEDULER_ENABLED=false`.

| Job (`modules/notifications/jobs.ts`) | Jadwal | Notifikasi |
| --- | --- | --- |
| SLA balasan (dari daftar percakapan Inbox, duplikat nomor digabung) | tiap menit | `reply.sla_warning` ke PIC (10–15 menit), `reply.takeover_open` ke CS lain diringkas per brand (≥ 15 menit, ditutup otomatis saat tidak ada lagi), `reply.escalation` ke Admin (≥ 30 menit). Episode lebih dari 3 jam diabaikan agar chat lama tidak membanjiri notifikasi saat pertama aktif. |
| Lead tanpa PIC | tiap menit | `lead.unassigned` ke Admin setelah 30 menit (hingga 24 jam) |
| Perangkat WA | tiap menit | Cadangan timer: `wa.disconnected` bila lebih dari 2 menit, dengan dedupe per kejadian (waktu perubahan status) sehingga timer dan job tidak mengirim dua kali |
| Gateway | tiap menit | `system.gateway_down` ke Superadmin setelah 2 kegagalan `/health` berturut-turut; `system.gateway_up` saat pulih |
| Bukti menunggu | tiap menit | `payment.proof_stale` ke Finance (≥ 2 jam), lalu Finance dan Admin (≥ 1 hari) |
| Ringkasan pagi | 08.00 WIB | `followup.due_today`, `followup.overdue` per CS; `invoice.overdue` per prospek ke PIC; `invoice.overdue_digest` per brand ke Finance; `brand.no_active_cs` |
| Ringkasan sore | 17.00 WIB | `pic.taken_over_digest` per brand ke Admin (jumlah per PIC lama) |
| Retensi | 03.00 WIB | Hapus notifikasi dibaca lebih dari 60 hari, belum dibaca lebih dari 180 hari, dedupe lebih dari 14 hari, kunci tick lebih dari 1 hari |

**Tolak bukti transfer:**
- Endpoint `POST /prospects/:id/reject-proof` (Finance/Admin, alasan wajib).
  - Bersyarat pada bukti yang sedang dilihat.
  - Menolak bukti yang sudah dipakai pembayaran terverifikasi.
  - Berkas tetap disimpan untuk audit.
  - Riwayat mencatat `payment_proof_rejected`.
- Notifikasi `payment.rejected` (mendesak) ke PIC; notifikasi ini ditutup saat bukti baru diajukan.
- Di halaman Verifikasi: tombol **Tolak** dengan dialog alasan dan pilihan alasan cepat.

**Penutupan otomatis tambahan:**
- balasan terkirim menutup `reply.sla_warning` dan `reply.escalation`;
- verifikasi atau penolakan menutup `payment.proof_stale`.

**Tes:**
- API: 105/105 (+15: job SLA, bukti menunggu, ringkasan pagi, gateway, retensi, scheduler, tolak bukti).
- Web: 36/36 (+1: dialog tolak bukti).

**Catatan:**
- Ambang dihitung 24 jam; jam operasional (pertanyaan 11.2) belum diterapkan. Semua ambang ada di `SLA` pada `jobs.ts`.
- Job SLA membangun daftar percakapan per brand tiap menit. Bila data sudah besar, pertimbangkan query khusus atau interval yang lebih jarang.

### F3 — Preferensi dan kerapian (selesai)

- **Katalog notifikasi** (`packages/shared-types/src/notifications.ts`): 31 tipe dengan kelompok, label, deskripsi, prioritas default, dan role penerima. `NotificationType` di API sekarang diturunkan dari katalog ini.
- **Preferensi** (`GET/PUT /api/v1/notifications/preferences`): toast dan suara per tipe, hanya untuk tipe yang relevan dengan role.
  - Default: toast untuk Tindakan dan Mendesak, tidak untuk Info; suara mati.
  - Notifikasi Mendesak selalu tampil sebagai toast.
- **Server menghitung preferensi** setiap penerima dan mengirim `toast`/`sound` bersama event `notification:new`, sehingga semua tab dan perangkat user konsisten tanpa cache di klien.
- **Halaman `/pengaturan/notifikasi`:**
  - dikelompokkan per kategori, dengan toggle (`role="switch"`) yang langsung tersimpan;
  - tombol **Uji suara**;
  - bisa dibuka dari menu akun di sidebar dan ikon gerigi di panel lonceng.
- **Suara:** nada pendek WebAudio (dua nada untuk Mendesak). Hanya tab yang terakhir difokuskan yang berbunyi.
- **Judul tab:** menampilkan jumlah belum dibaca, mis. `(3) CRM AZHAN`.
- **Lonceng di Inbox layar kecil:** di header daftar percakapan (`lg:hidden`).
- **Toast global untuk umpan balik halaman:** `showFeedback(pesan, { error })` menggantikan toast lokal di Pipeline, Verifikasi, Staff, Brand, Detail Brand, Paket, Detail Paket, Meta CAPI, Admin, dan Inbox. Semua toast kini berada di satu tumpukan dan tidak saling menimpa. Error tetap tampil sampai ditutup.

**Tes:**
- shared-types: 14/14.
- API: 108/108 (+3: preferensi pada event realtime, GET/PUT preferensi).
- Web: 39/39 (+3: halaman preferensi, judul tab).
