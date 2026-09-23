import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import type { SessionUser } from '@csumroh/shared-types';
import { allowedOrigins, env } from '../config/env.js';

let io: Server | undefined;
const HOLDING_ROOM = 'holding';

export function createSocketServer(server: HttpServer) {
  io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } });
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token as string;
      socket.data.user = jwt.verify(token, env.JWT_ACCESS_SECRET) as SessionUser;
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
  });
  return io;
}

export function emitToBrand(brandId: number, event: string, payload: unknown) {
  // Satu emit ke gabungan room: socket yang ada di keduanya tetap menerima event sekali.
  io?.to([`brand:${brandId}`, HOLDING_ROOM]).emit(event, payload);
}
