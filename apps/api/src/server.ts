import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { allowedOrigins, env } from './config/env.js';
import { errorHandler } from './utils/http.js';
import { authGuard } from './middleware/auth.js';
import { protectUploads } from './modules/auth/media-access.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { prospectsRouter } from './modules/prospects/prospects.routes.js';
import { customRouter } from './modules/custom/custom.routes.js';
import { verificationRouter } from './modules/finance/verification.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { scriptsRouter } from './modules/scripts/scripts.routes.js';
import { chatRouter, internalRouter } from './modules/chat/chat.routes.js';
import { capiRouter } from './modules/capi/capi.routes.js';
import { whatsappRouter } from './modules/whatsapp/whatsapp.routes.js';
import { contactsRouter } from './modules/contacts/contacts.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { createSocketServer } from './realtime/socket.js';
import { startScheduler } from './jobs/scheduler.js';
import { ensureConversationStats } from './modules/chat/conversation-stats.js';

import path from 'node:path';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// JSON daftar percakapan/pesan menyusut ±80–90% dengan gzip; gambar/video (sudah terkompresi) dilewati filter bawaan.
app.use(compression({ threshold: 1024 }));
app.use(cors({ origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); }, credentials: true }));
// Batas body: kecil secara bawaan. Body besar (media/flyer/logo/bukti berbentuk base64) hanya diterima pada
// rute unggahan dan SETELAH token diverifikasi, agar request anonim tidak bisa mengirim puluhan MB (DoS).
const LARGE_BODY_ROUTES = [
  /^\/api\/v1\/chat\/messages\/media$/,
  /^\/api\/v1\/catalog\/brands\/upload-logo$/,
  /^\/api\/v1\/catalog\/packages\/upload-flyer$/,
  /^\/api\/v1\/prospects\/\d+\/payment-proof(?:-upload)?$/,
];
const smallJson = express.json({ limit: '1mb' });
const internalJson = express.json({ limit: '10mb' });
const largeJson = express.json({ limit: '50mb' });
app.use((req, res, next) => {
  if (LARGE_BODY_ROUTES.some((route) => route.test(req.path))) {
    return authGuard(req, res, (error?: unknown) => (error ? next(error) : largeJson(req, res, next)));
  }
  if (req.path.startsWith('/internal/')) return internalJson(req, res, next);
  return smallJson(req, res, next);
});

app.use(cookieParser());
// Media chat & foto profil jamaah hanya untuk staf yang masuk (cookie media); flyer & logo tetap publik.
// Nama berkas di /uploads selalu unik (timestamp + acak) → aman di-cache lama. Media privat sudah diberi
// 'Cache-Control: private' oleh protectUploads (tidak ditimpa express.static).
app.use('/uploads', protectUploads, express.static(path.resolve(process.cwd(), 'uploads'), { maxAge: '30d', immutable: true }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'csumroh-api' }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/prospects', prospectsRouter);
app.use('/api/v1/custom-requests', customRouter);
app.use('/api/v1/verification', verificationRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/catalog', catalogRouter);
app.use('/api/v1/scripts', scriptsRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/meta', capiRouter);
app.use('/api/v1/whatsapp', whatsappRouter);
app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/internal', internalRouter);
app.use((_req, res) => res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' }));
app.use(errorHandler);

const server = createServer(app);
createSocketServer(server);
server.listen(env.API_PORT, () => {
  console.log(`CS Umroh API ready on :${env.API_PORT}`);
  startScheduler();
  // Isi ringkasan percakapan prospek lama (sekali setelah migrasi) di latar belakang.
  void ensureConversationStats().catch((error) => console.error('Backfill ringkasan percakapan gagal', error));
});
