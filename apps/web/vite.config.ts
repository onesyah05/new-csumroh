import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Satu .env di root monorepo dipakai bersama API, gateway, dan web.
const envDir = path.resolve(__dirname, '../..');

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, envDir, 'VITE_');
  // Build produksi tanpa URL API akan diam-diam memanggil localhost di browser pengguna.
  if (command === 'build' && mode === 'production' && (!env.VITE_API_URL || !env.VITE_SOCKET_URL)) {
    throw new Error('VITE_API_URL dan VITE_SOCKET_URL wajib diisi di .env root sebelum build produksi.');
  }
  const apiOrigin = (env.VITE_API_URL || 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

  return {
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiOrigin, changeOrigin: true },
        '/uploads': { target: apiOrigin, changeOrigin: true },
      },
    },
  };
});
