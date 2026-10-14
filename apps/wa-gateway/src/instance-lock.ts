import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import path from 'node:path';

export type LockResult = { acquired: true; release: () => void } | { acquired: false; holderPid: number };

/** Pemegang kunci memperbarui waktu berkas ini; kunci yang tidak diperbarui selama batas ini dianggap basi. */
export const LOCK_HEARTBEAT_MS = 10_000;
export const LOCK_STALE_MS = 90_000;

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = proses ada tetapi milik user lain; tetap dianggap hidup.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockAgeMs(lockPath: string) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Kunci satu-instance untuk folder sesi WhatsApp. Dua gateway yang memakai kredensial yang sama
 * saling memutus sesi di server WhatsApp ("connection replaced") tanpa henti, jadi instance kedua
 * harus menolak jalan. Kunci basi diambil alih: milik proses yang sudah mati (crash / dimatikan paksa),
 * atau yang tidak diperbarui lagi walau nomor prosesnya kini dipakai proses lain (reboot, kontainer).
 */
export function acquireInstanceLock(dir: string, pid = process.pid): LockResult {
  mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, '.gateway.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(pid));
      closeSync(fd);
      // Detak: tanda bahwa pemegang kunci memang masih berjalan, bukan sekadar nomor proses yang kebetulan hidup.
      const heartbeat = setInterval(() => {
        try {
          const now = new Date();
          utimesSync(lockPath, now, now);
        } catch {
          // Kunci hilang; release() menangani pembersihan.
        }
      }, LOCK_HEARTBEAT_MS);
      heartbeat.unref?.();
      return {
        acquired: true,
        release: () => {
          clearInterval(heartbeat);
          try {
            if (readFileSync(lockPath, 'utf8').trim() === String(pid)) rmSync(lockPath, { force: true });
          } catch {
            // Kunci sudah hilang; tidak ada yang perlu dilepas.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holderPid = Number(readFileSync(lockPath, 'utf8').trim());
      const alive = holderPid !== pid && isProcessAlive(holderPid);
      if (alive && lockAgeMs(lockPath) < LOCK_STALE_MS) return { acquired: false, holderPid };
      rmSync(lockPath, { force: true }); // kunci basi
    }
  }
  throw new Error(`Tidak dapat membuat kunci instance di ${lockPath}`);
}
