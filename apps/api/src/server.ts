import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { allowedOrigins, env } from './config/env.js';
import { errorHandler } from './utils/http.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { prospectsRouter } from './modules/prospects/prospects.routes.js';
import { verificationRouter } from './modules/finance/verification.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { scriptsRouter } from './modules/scripts/scripts.routes.js';
import { chatRouter, internalRouter } from './modules/chat/chat.routes.js';
import { capiRouter } from './modules/capi/capi.routes.js';
import { whatsappRouter } from './modules/whatsapp/whatsapp.routes.js';
import { contactsRouter } from './modules/contacts/contacts.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { createSocketServer } from './realtime/socket.js';
import { startScheduler } from './jobs/scheduler.js';

import path from 'node:path';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); }, credentials: true }));
app.use(express.json({ limit: '50mb' }));

app.use(cookieParser());
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'csumroh-api' }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/prospects', prospectsRouter);
app.use('/api/v1/verification', verificationRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/catalog', catalogRouter);
app.use('/api/v1/scripts', scriptsRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/meta', capiRouter);
app.use('/api/v1/whatsapp', whatsappRouter);
app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/internal', internalRouter);
app.use((_req, res) => res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' }));
app.use(errorHandler);

const server = createServer(app);
createSocketServer(server);
server.listen(env.API_PORT, () => {
  console.log(`CS Umroh API ready on :${env.API_PORT}`);
  startScheduler();
});
