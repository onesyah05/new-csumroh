import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
