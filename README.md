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

## Perintah verifikasi

```bash
pnpm typecheck
pnpm test
pnpm build
```

Lihat [`prd-csumroh.md`](./prd-csumroh.md) dan [`AGENTS-csumroh.md`](./AGENTS-csumroh.md) sebagai sumber requirement proyek.
