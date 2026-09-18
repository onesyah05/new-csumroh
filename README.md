# CS Umroh — React CRM & Shared Inbox

Rewrite TypeScript dari `csumroh-php`: React SPA, Express REST API, Socket.io, Prisma/MySQL, serta gateway WhatsApp per brand. Aplikasi mendukung role **Super Admin**, **Admin Brand**, dan **Customer Service**.

## Menjalankan lokal

Persyaratan: Node.js 20+, pnpm, dan MySQL 8.

```bash
pnpm install
cp .env.example .env
# sesuaikan DATABASE_URL, secret, dan password bootstrap superadmin
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

`db:seed` hanya membuat akun superadmin awal. Brand, paket, user tim, prospek,
percakapan, dan status WhatsApp tidak pernah dibuat sebagai data contoh; semuanya
berasal dari input operator di aplikasi, MySQL, atau koneksi WhatsApp yang aktif.

Untuk instalasi lama yang pernah memakai seed demo, jalankan sekali:

```bash
pnpm db:clean-demo
```

Web berjalan di `http://localhost:5173`, API di `http://localhost:4000`, dan gateway WA (opsional) di `http://localhost:4001`.

## Akses role

- `superadmin`: lintas brand, mengelola brand, paket, dan user.
- `admin`: hanya satu brand; mengelola paket dan user CS pada brand tersebut.
- `cs`: shared inbox, CRM, Copilot, dan LMS dalam brand sendiri.

Access token hanya disimpan di memory browser. Refresh token dirotasi melalui cookie `httpOnly`, `SameSite=Strict`. Semua query non-superadmin discoping oleh `brandId` dari JWT, bukan input client.

## Meta Pixel & CAPI CTWA per brand

Admin brand atau superadmin dapat membuka **Administrasi → Meta Pixel & CAPI** untuk mengatur Pixel/Dataset ID, Facebook Page ID, WhatsApp Business Account ID, System User Access Token, dan Test Event Code khusus brand tersebut.

- Access token disimpan terenkripsi dan tidak pernah dikirim kembali ke browser.
- Gunakan tombol **Tes koneksi** setelah menyimpan konfigurasi.
- `ctwa_clid` diambil dari referral pesan WhatsApp pertama dan tidak ditimpa referral berikutnya.
- Event otomatis: `Contact`, `AddToCart`, `InitiateCheckout`, dan `Purchase`.
- Hapus Test Event Code setelah verifikasi di Meta Events Manager agar event berikutnya masuk laporan produksi.
- Isi `META_TOKEN_ENCRYPTION_KEY` minimal 32 karakter pada environment produksi. Jika tidak diisi, aplikasi memakai `JWT_REFRESH_SECRET` sebagai material kunci fallback agar instalasi lama tetap berjalan.

## Perintah verifikasi

```bash
pnpm typecheck
pnpm test
pnpm build
```

Lihat [`prd-csumroh.md`](./prd-csumroh.md) dan [`AGENTS-csumroh.md`](./AGENTS-csumroh.md) sebagai sumber requirement proyek.
