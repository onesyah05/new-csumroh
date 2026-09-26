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
});

export const env = schema.parse(process.env);
if (env.NODE_ENV === 'production' && !env.META_TOKEN_ENCRYPTION_KEY) {
  throw new Error('META_TOKEN_ENCRYPTION_KEY wajib diisi di production (kunci enkripsi token Meta CAPI, terpisah dari secret JWT).');
}
export const allowedOrigins = env.WEB_ORIGIN.split(',').map((origin) => origin.trim());
