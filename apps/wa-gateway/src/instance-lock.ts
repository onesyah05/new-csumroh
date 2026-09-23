import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';

export type LockResult = { acquired: true; release: () => void } | { acquired: false; holderPid: number };

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

/**
 * Kunci satu-instance untuk folder sesi WhatsApp. Dua gateway yang memakai kredensial yang sama
 * saling memutus sesi di server WhatsApp ("connection replaced") tanpa henti, jadi instance kedua
 * harus menolak jalan. Kunci milik proses yang sudah mati (crash / dimatikan paksa) diambil alih.
 */
export function acquireInstanceLock(dir: string, pid = process.pid): LockResult {
  mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, '.gateway.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(pid));
      closeSync(fd);
      return {
        acquired: true,
        release: () => {
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
      if (holderPid !== pid && isProcessAlive(holderPid)) return { acquired: false, holderPid };
      rmSync(lockPath, { force: true }); // kunci basi
    }
  }
  throw new Error(`Tidak dapat membuat kunci instance di ${lockPath}`);
}
