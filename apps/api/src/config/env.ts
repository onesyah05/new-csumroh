import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  WA_GATEWAY_SECRET: z.string().min(16),
  WA_GATEWAY_URL: z.string().url().default('http://localhost:4001'),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v20.0'),
  META_TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  // Notifikasi in-app dapat dimatikan per lingkungan tanpa mengubah kode.
  NOTIFICATIONS_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  // Job berkala (SLA balasan, ringkasan harian, retensi). Matikan di tes atau bila menjalankan beberapa proses tanpa kebutuhan.
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  // Batas waktu panggilan Asisten AI. Kunci API, model, dan peserta diatur Superadmin di dashboard (tabel ai_settings).
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  // Batas permintaan saran AI per hari untuk seluruh tim (plafon biaya, di luar batas per pengguna).
  AI_DAILY_LIMIT_GLOBAL: z.coerce.number().int().positive().default(3000),
  // Pengiriman ke Meta (CAPI realtime, audiens spam) hanya di production. Salinan database di laptop memuat token asli:
  // tanpa penjaga ini, mengganti status prospek secara lokal mengirim konversi sungguhan ke Pixel produksi.
  META_ALLOW_NON_PRODUCTION: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  // Kunci enkripsi lama (dipisah koma) agar token yang dienkripsi sebelum rotasi tetap terbaca sampai dienkripsi ulang.
  META_TOKEN_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  // Meta App untuk tombol "Hubungkan Meta" (OAuth). Kosong = tombol tidak tampil, token ditempel manual.
  META_APP_ID: z.string().regex(/^\d+$/).optional(),
  META_APP_SECRET: z.string().min(16).optional(),
  // URL publik callback, harus sama persis dengan "Valid OAuth Redirect URIs" di Meta App. Contoh: https://crm.example.com/api/v1/meta/oauth/callback
  META_OAUTH_REDIRECT_URI: z.string().url().optional(),
});

export const env = schema.parse(process.env);
if (env.NODE_ENV === 'production' && !env.META_TOKEN_ENCRYPTION_KEY) {
  throw new Error('META_TOKEN_ENCRYPTION_KEY wajib diisi di production (kunci enkripsi token Meta CAPI, terpisah dari secret JWT).');
}
export const allowedOrigins = env.WEB_ORIGIN.split(',').map((origin) => origin.trim());
