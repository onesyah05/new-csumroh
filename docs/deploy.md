# Deploy ke Produksi

Satu-satunya panduan deploy yang berlaku. Diperbarui 2 Oktober 2026. Panduan lama (`panduan-deploy-device-scope-2026-09-27.md`) sudah usang.

---

## 1. Gambaran server

| Hal | Nilai |
|---|---|
| Server | `76.13.22.139`, dikelola lewat aaPanel (port 8888) |
| Folder aplikasi | `/www/wwwroot/new_csumroh` (monorepo, cabang `main`) |
| Node | `/www/server/nodejs/v22.23.2/bin` (tidak ada di PATH default) |
| pnpm | dipanggil lewat `corepack pnpm` (versi dari `packageManager`, saat ini 11.1.2) |
| API | service systemd `csumroh-api`, port `9181`, health `127.0.0.1:9181/health` |
| Gateway WhatsApp | service systemd `csumroh-wa`, port `9182`, user `www`, `Restart=always`, folder kerja `apps/wa-gateway`, health `127.0.0.1:9182/health` |
| Web | hasil build `apps/web/dist`, disajikan nginx di `https://crm.azhan.id` |
| Database | MySQL `csumroh_react` (kredensial di `.env` root) |
| Antrean gateway | `apps/wa-gateway/outbox/` (pesan yang belum diterima API) |
| Sesi WhatsApp | `apps/wa-gateway/sessions/brand_<id>/` |

Kepemilikan file campur: folder repo milik `www`, sebagian `node_modules` (Prisma client) milik `root`. Karena itu build dan migrasi dijalankan sebagai root (lihat aturan di bawah).

---

## 2. Aturan

1. **Kode yang di-deploy selalu dari `origin/main`.** Merge `dev-malik` → `main` dan push dulu.
2. **`git pull` dijalankan sebagai user `deploy`** (`runuser -u deploy -- git ...`), supaya kepemilikan `.git` tidak berubah.
3. **Install, migrasi, build, dan restart dijalankan sebagai root** lewat aaPanel › Cron › Shell Script (Execute user: root). Terminal aaPanel meminta password root; Cron tidak.
4. **pnpm selalu lewat `corepack pnpm`** dengan PATH Node aaPanel dan `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`. `corepack enable` gagal (folder bin milik root) dan tidak diperlukan.
5. **Selalu tampilkan commit hasil pull** (`git log --oneline -1`) dan cocokkan dengan commit terakhir di `main`. Pernah terjadi build memakai kode lama karena pull terlewat.
6. **Gateway hanya di-build/restart bila `apps/wa-gateway` berubah.** Restart gateway memutus WhatsApp semua brand beberapa detik (tersambung lagi otomatis).
7. **Jangan menjalankan gateway di laptop yang punya folder `sessions/` asli.** Gateway lokal akan merebut sesi WhatsApp produksi.
8. **Job sinkron Meta CAPI (retry + backfill) hanya berjalan bila `NODE_ENV=production`.** Database salinan di laptop menyimpan token Meta asli; jangan ubah penjagaan ini.
9. **Perubahan data massal selalu lewat script dengan pratinjau dulu**, lalu `--apply` setelah angkanya disetujui.
10. **Setelah selesai, matikan jadwal task Cron deploy** (atau hapus), supaya tidak ikut jalan otomatis tiap hari.

---

## 3. Memilih varian script

| Yang berubah | Varian |
|---|---|
| Hanya `apps/api`, `apps/web`, `packages/shared-types` | **A** |
| Ada folder baru di `apps/api/prisma/migrations/` | **B** |
| `apps/wa-gateway` ikut berubah | **C** (bisa digabung dengan B) |
| `pnpm-lock.yaml` berubah (dependency baru) | tambahkan langkah install (lihat B) |

Cara cepat melihat yang berubah: commit yang terakhir di-deploy tercatat di log Cron deploy sebelumnya (baris setelah `git pull`). Di laptop:

```bash
git fetch origin
```

```bash
git diff --stat <commit-terakhir-di-server> origin/main
```

---

## 4. Script

Tempel di aaPanel › Cron › **Add Task** › Task type **Shell Script**, Execute user **root**, lalu klik **Execute** dan buka **Log**.

### A. API + web (tanpa migrasi, tanpa gateway)

```bash
#!/bin/bash
APP=/www/wwwroot/new_csumroh
export PATH=/www/server/nodejs/v22.23.2/bin:$PATH
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
runuser -u deploy -- git -C $APP pull origin main || { echo PULL GAGAL; exit 1; }
git -c safe.directory=$APP -C $APP log --oneline -1
cd $APP || exit 1
P="corepack pnpm"
$P --filter @csumroh/shared-types build && $P --filter @csumroh/api build && $P --filter @csumroh/web build || { echo BUILD GAGAL; exit 1; }
systemctl restart csumroh-api
sleep 5
systemctl status csumroh-api --no-pager | grep Active
curl -s 127.0.0.1:9181/health; echo
echo DEPLOY SELESAI
```

### B. Dengan migrasi database (dan install dependency)

Sebelum menjalankan: pastikan backup database harian (aaPanel › Cron › Backup Database) berhasil hari ini, atau buat backup manual dari aaPanel › Databases.

```bash
#!/bin/bash
APP=/www/wwwroot/new_csumroh
export PATH=/www/server/nodejs/v22.23.2/bin:$PATH
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
runuser -u deploy -- git -C $APP pull origin main || { echo PULL GAGAL; exit 1; }
git -c safe.directory=$APP -C $APP log --oneline -1
cd $APP || exit 1
P="corepack pnpm"
$P install --frozen-lockfile || { echo INSTALL GAGAL; exit 1; }
$P --filter @csumroh/api db:generate || { echo GENERATE GAGAL; exit 1; }
$P --filter @csumroh/api db:migrate || { echo MIGRATE GAGAL; exit 1; }
$P --filter @csumroh/shared-types build && $P --filter @csumroh/api build && $P --filter @csumroh/web build || { echo BUILD GAGAL - service tidak direstart; exit 1; }
systemctl restart csumroh-api
sleep 5
systemctl status csumroh-api --no-pager | grep Active
curl -s 127.0.0.1:9181/health; echo
echo DEPLOY SELESAI
```

Di log, migrasi baru harus tercatat "Applying migration `…`", atau "No pending migrations to apply" bila sudah pernah jalan.

### C. Dengan gateway WhatsApp

Sama dengan A atau B, ditambah build gateway dan restart kedua service. WhatsApp semua brand putus beberapa detik.

```bash
#!/bin/bash
APP=/www/wwwroot/new_csumroh
export PATH=/www/server/nodejs/v22.23.2/bin:$PATH
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
runuser -u deploy -- git -C $APP pull origin main || { echo PULL GAGAL; exit 1; }
git -c safe.directory=$APP -C $APP log --oneline -1
cd $APP || exit 1
P="corepack pnpm"
$P --filter @csumroh/api db:generate || { echo GENERATE GAGAL; exit 1; }
$P --filter @csumroh/api db:migrate || { echo MIGRATE GAGAL; exit 1; }
$P --filter @csumroh/shared-types build && $P --filter @csumroh/api build && $P --filter @csumroh/web build && $P --filter @csumroh/wa-gateway build || { echo BUILD GAGAL - service tidak direstart; exit 1; }
systemctl restart csumroh-api csumroh-wa
sleep 8
systemctl status csumroh-api csumroh-wa --no-pager | grep -E 'service -|Active'
curl -s 127.0.0.1:9181/health; echo
curl -s 127.0.0.1:9182/health; echo
echo DEPLOY SELESAI
```

Di health gateway, `queued` harus 0 atau segera turun ke 0 (pesan yang tertahan selama restart dikirim ulang ke API).

---

## 5. Cek setelah deploy

1. **Log Cron:** commit hasil pull = commit terakhir `main`; build web selesai dengan `✓ built`; service `active (running)` dengan jam start baru; health `{"status":"ok"…}`.
2. **Web benar-benar baru:** nama file `assets/index-XXXX.js` di log build harus sama dengan yang dimuat `https://crm.azhan.id` (lihat sumber halaman, atau buka DevTools › Network). Nama yang sama dengan deploy sebelumnya berarti kode lama yang ter-build.
3. **Perangkat WhatsApp** (bila gateway di-restart): Brand Travel › tiap brand › Perangkat WhatsApp harus "Terhubung" dalam beberapa detik.
4. **Fitur yang diubah:** buka halamannya, tekan Ctrl+Shift+R, cek sekali.

---

## 6. Perbaikan data sekali jalan

Script data ada di `apps/api/prisma/*.ts` dan didaftarkan sebagai `db:…` di `apps/api/package.json` (contoh: `db:backfill:contact`). Selalu dua tahap:

```bash
# Tahap 1 — pratinjau, tidak mengubah apa pun
cd /www/wwwroot/new_csumroh && PATH=/www/server/nodejs/v22.23.2/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @csumroh/api db:backfill:contact

# Tahap 2 — setelah angkanya disetujui
cd /www/wwwroot/new_csumroh && PATH=/www/server/nodejs/v22.23.2/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @csumroh/api db:backfill:contact -- --apply
```

Script baru wajib: tanpa `--apply` hanya menampilkan jumlah per brand; dengan `--apply` bersyarat pada keadaan awal (aman dijalankan dua kali) dan mencatat perubahan di riwayat prospek.

---

## 7. Rollback

Kode bisa dikembalikan; **migrasi database tidak mundur sendiri**. Bila deploy bermasalah dan ada migrasi, periksa dulu apakah kode lama masih cocok dengan tabel baru (kolom tambahan biasanya aman; kolom yang dihapus/diubah tidak).

```bash
#!/bin/bash
APP=/www/wwwroot/new_csumroh
GOOD=<commit-terakhir-yang-baik>
export PATH=/www/server/nodejs/v22.23.2/bin:$PATH
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
runuser -u deploy -- git -C $APP checkout $GOOD || { echo CHECKOUT GAGAL; exit 1; }
cd $APP || exit 1
P="corepack pnpm"
$P --filter @csumroh/api db:generate
$P --filter @csumroh/shared-types build && $P --filter @csumroh/api build && $P --filter @csumroh/web build && $P --filter @csumroh/wa-gateway build || { echo BUILD GAGAL; exit 1; }
systemctl restart csumroh-api csumroh-wa
sleep 8
systemctl status csumroh-api csumroh-wa --no-pager | grep -E 'service -|Active'
echo ROLLBACK SELESAI
```

Setelah masalah diperbaiki di `main`, kembalikan server ke cabang `main` dengan menambahkan `runuser -u deploy -- git -C $APP checkout main` di awal script deploy berikutnya.

---

## 8. Kendala yang pernah terjadi

| Gejala | Penyebab | Solusi |
|---|---|---|
| `Command 'pnpm' not found` | PATH Node aaPanel tidak dimuat | Pakai script di atas (export PATH + `corepack pnpm`) |
| `corepack enable` → `EACCES … symlink` | Folder bin Node milik root | Tidak perlu `enable`; panggil `corepack pnpm` |
| `prisma generate` → `EACCES … unlink` | File Prisma client milik root, build dijalankan sebagai `www`/`deploy` | Jalankan build sebagai root (Cron) |
| Deploy "berhasil" tapi tampilan tidak berubah; nama `index-*.js` sama dengan sebelumnya | `git pull` tidak dijalankan sebelum build | Script selalu diawali pull + `git log --oneline -1` |
| `P3005` saat migrasi | Database belum di-baseline | Sudah diselesaikan 2026-09; bila muncul lagi jangan `migrate reset`, hubungi developer |
| WhatsApp putus setelah deploy dan tidak kembali | Gateway gagal start (lihat `systemctl status csumroh-wa`) | Cek log `journalctl -u csumroh-wa -n 100`; sesi yang dikeluarkan dari HP perlu scan ulang di Perangkat WhatsApp |
| Event Meta CAPI gagal massal setelah deploy | Konfigurasi brand (dataset belum ditautkan ke Page, token) | Lihat `docs/panduan-integrasi-meta-2026-09-30.md` bagian Z, lalu "Kirim ulang yang gagal" |
