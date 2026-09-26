import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import type { SessionUser } from '@csumroh/shared-types';
import { isTokenRevoked } from '../modules/auth/sessions.js';
import { allowedOrigins, env } from '../config/env.js';

let io: Server | undefined;
const HOLDING_ROOM = 'holding';

export function createSocketServer(server: HttpServer) {
  io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } });
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token as string;
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as SessionUser & { type?: string; iat?: number; exp?: number };
      if (payload.type !== 'access' || isTokenRevoked(payload.id, payload.iat)) throw new Error('revoked');
      socket.data.user = payload;
      socket.data.exp = payload.exp;
      next();
    } catch { next(new Error('unauthorized')); }
  });
  io.on('connection', (socket) => {
    const user = socket.data.user as SessionUser;
    // Room mengikuti scope yang sama dengan scopedBrandId: pengawas holding menerima event semua
    // brand; CS menerima event brand utama DAN semua brand penugasan UserBrand.
    if (user.role === 'superadmin' || user.role === 'admin' || user.role === 'finance') socket.join(HOLDING_ROOM);
    const brandIds = new Set<number>();
    if (user.brandId) brandIds.add(user.brandId);
    for (const ub of user.userBrands ?? []) if (ub.brand?.id) brandIds.add(ub.brand.id);
    for (const brandId of brandIds) socket.join(`brand:${brandId}`);
    // Room pribadi untuk notifikasi in-app: semua tab/perangkat user yang sama.
    socket.join(userRoom(user.id));
    // Koneksi tidak boleh hidup lebih lama dari token-nya: diputus saat kedaluwarsa, klien menyambung ulang
    // dengan token hasil refresh (atau keluar bila akses sudah dicabut).
    const exp = Number(socket.data.exp);
    if (exp) {
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, exp * 1000 - Date.now()));
      socket.on('disconnect', () => clearTimeout(timer));
    }
  });
  return io;
}

export function emitToBrand(brandId: number, event: string, payload: unknown) {
  // Satu emit ke gabungan room: socket yang ada di keduanya tetap menerima event sekali.
  io?.to([`brand:${brandId}`, HOLDING_ROOM]).emit(event, payload);
}

const userRoom = (userId: number) => `user:${userId}`;

/** Putus semua koneksi realtime milik user (akses dicabut). */
export function disconnectUser(userId: number) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}

export function emitToUser(userId: number, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}
