import { DisconnectReason } from '@whiskeysockets/baileys';

/** Alasan putus yang dikirim ke API dan ditampilkan ke admin. Samakan dengan `WA_DISCONNECT_REASONS` di shared-types. */
export type DisconnectKind = 'logged_out' | 'replaced' | 'forbidden' | 'restart' | 'connection_lost';

/**
 * Klasifikasi kode putus Baileys. permanent = menyambung ulang tidak akan berhasil (butuh scan ulang atau tindakan
 * manusia); mengulang terus hanya membebani server WhatsApp dan bisa memperparah pembatasan akun.
 */
export function classifyDisconnect(code?: number): { kind: DisconnectKind; permanent: boolean; clearCredentials: boolean } {
  if (code === DisconnectReason.loggedOut || code === DisconnectReason.multideviceMismatch) {
    return { kind: 'logged_out', permanent: true, clearCredentials: true };
  }
  // Sesi yang sama dibuka di tempat lain (mis. gateway kedua): sambung ulang = saling memutus tanpa henti.
  if (code === DisconnectReason.connectionReplaced) return { kind: 'replaced', permanent: true, clearCredentials: false };
  if (code === DisconnectReason.forbidden) return { kind: 'forbidden', permanent: true, clearCredentials: false };
  if (code === DisconnectReason.restartRequired) return { kind: 'restart', permanent: false, clearCredentials: false };
  return { kind: 'connection_lost', permanent: false, clearCredentials: false };
}

const BASE_DELAY_MS = 2_500;
const MAX_DELAY_MS = 5 * 60_000;

/** Jeda sambung ulang: 2,5 dtk, 5 dtk, 10 dtk, … maksimal 5 menit. */
export function reconnectDelayMs(attempt: number) {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt), MAX_DELAY_MS);
}
