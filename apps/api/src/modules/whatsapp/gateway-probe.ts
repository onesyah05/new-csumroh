import type { WhatsappSession } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';

export type LiveWaStatus = 'connected' | 'connecting' | 'qr_ready' | 'disconnected';
export type GatewayProbe =
  | { reachable: true; status: LiveWaStatus; phoneNumber: string | null }
  | { reachable: false; confirmedDown: boolean };

/**
 * Satu kali tidak menjawab belum berarti putus: gateway sering sibuk (impor riwayat setelah scan, unduh media).
 * Sesi baru ditandai putus setelah beberapa pemeriksaan berturut-turut gagal.
 */
export const PROBE_FAILURES_TO_DISCONNECT = 2;
const PROBE_TIMEOUT_MS = 3_000;
const failures = new Map<number, number>();

export function resetGatewayProbes() {
  failures.clear();
}

export async function probeGatewaySession(brandId: number): Promise<GatewayProbe> {
  const response = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/status`, {
    headers: { 'x-internal-secret': env.WA_GATEWAY_SECRET },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) {
    const count = (failures.get(brandId) ?? 0) + 1;
    failures.set(brandId, count);
    return { reachable: false, confirmedDown: count >= PROBE_FAILURES_TO_DISCONNECT };
  }
  failures.delete(brandId);
  const body = (await response.json().catch(() => null)) as { data?: { status?: string; phoneNumber?: string | null } } | null;
  const raw = body?.data?.status;
  const status: LiveWaStatus = raw === 'connected' || raw === 'connecting' || raw === 'qr_ready' || raw === 'disconnected' ? raw : 'disconnected';
  const rawPhone = body?.data?.phoneNumber ?? null;
  const phoneNumber = rawPhone ? rawPhone.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') || null : null;
  return { reachable: true, status, phoneNumber };
}

/**
 * Samakan status sesi di database dengan gateway. Gateway yang tidak menjawab baru dianggap putus setelah
 * PROBE_FAILURES_TO_DISCONNECT pemeriksaan berturut-turut, dengan alasan "gateway_unreachable".
 */
export async function syncSessionWithGateway(brandId: number, session: WhatsappSession | null): Promise<WhatsappSession | null> {
  const probe = await probeGatewaySession(brandId);
  if (!session) return session;
  if (!probe.reachable) {
    if (!probe.confirmedDown || (session.status !== 'connected' && session.status !== 'connecting')) return session;
    return prisma.whatsappSession.update({ where: { brandId }, data: { status: 'disconnected', qrCode: null, disconnectReason: 'gateway_unreachable' } });
  }
  if (session.status === probe.status) return session;
  return prisma.whatsappSession.update({
    where: { brandId },
    data: {
      status: probe.status,
      phoneNumber: probe.phoneNumber || session.phoneNumber,
      qrCode: probe.status === 'connected' ? null : session.qrCode,
      ...(probe.status === 'connected' ? { disconnectReason: null } : {}),
      ...(probe.status === 'disconnected' && !session.disconnectReason ? { disconnectReason: 'connection_lost' } : {}),
    },
  });
}
