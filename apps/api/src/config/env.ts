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
});

export const env = schema.parse(process.env);
export const allowedOrigins = env.WEB_ORIGIN.split(',').map((origin) => origin.trim());
