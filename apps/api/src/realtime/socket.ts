import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import type { SessionUser } from '@csumroh/shared-types';
import { allowedOrigins, env } from '../config/env.js';

let io: Server | undefined;

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
    if (user.role === 'superadmin') socket.join('superadmin');
    if (user.brandId) socket.join(`brand:${user.brandId}`);
  });
  return io;
}

export function emitToBrand(brandId: number, event: string, payload: unknown) {
  io?.to(`brand:${brandId}`).emit(event, payload);
  io?.to('superadmin').emit(event, payload);
}
