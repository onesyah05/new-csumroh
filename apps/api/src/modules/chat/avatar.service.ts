import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { AVATAR_URL_PATTERN, avatarNeedsRefresh } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { detectProofType, isPathInside } from '../../utils/safe-path.js';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** Kontak tanpa foto (atau gateway terputus) tidak dicoba ulang terus-menerus. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const lastAttempt = new Map<number, number>();

const avatarsDir = (cwd = process.cwd()) => path.resolve(cwd, 'uploads', 'avatars');

type AvatarProspect = { id: number; brandId: number; remoteJid: string | null; phone: string | null; photoUrl: string | null };

/**
 * Permintaan foto profil ke WhatsApp diantre satu per satu per device dengan jeda. Daftar Inbox dimuat ulang setiap ada
 * pesan di setiap browser CS; tanpa batas ini ratusan permintaan per jam diduga membuat WhatsApp memutus koneksi
 * device (stream error 500). Antrean penuh = permintaan dilewati, dicoba lagi pada pemuatan berikutnya.
 */
let profilePicGapMs = 3_000;
const MAX_QUEUED_PER_BRAND = 20;
const brandQueues = new Map<number, { tail: Promise<unknown>; pending: number }>();

function throttledPerBrand<T>(brandId: number, task: () => Promise<T>): Promise<T> | null {
  const queue = brandQueues.get(brandId) ?? { tail: Promise.resolve(), pending: 0 };
  if (queue.pending >= MAX_QUEUED_PER_BRAND) return null;
  queue.pending += 1;
  const run = queue.tail.then(task, task);
  queue.tail = run
    .catch(() => undefined)
    .then(() => new Promise((resolve) => setTimeout(resolve, profilePicGapMs)))
    .finally(() => { queue.pending -= 1; });
  brandQueues.set(brandId, queue);
  return run;
}

/** ok: false = gateway tidak menjawab (putus/sibuk), bukan kontak tanpa foto; tidak dicatat sebagai sudah dicek. */
async function fetchProfilePicUrl(prospect: AvatarProspect): Promise<{ ok: boolean; url: string | null }> {
  const params = new URLSearchParams();
  if (prospect.remoteJid) params.set('jid', prospect.remoteJid);
  if (prospect.phone) params.set('phone', prospect.phone);
  const response = await fetch(`${env.WA_GATEWAY_URL}/sessions/${prospect.brandId}/profile-pic?${params.toString()}`, {
    headers: { 'x-internal-secret': env.WA_GATEWAY_SECRET },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return { ok: false, url: null };
  const body = await response.json().catch(() => null) as { data?: { url?: string | null } } | null;
  const url = body?.data?.url;
  return { ok: true, url: url && /^https:\/\//.test(url) ? url : null };
}

function removeLocalAvatar(photoUrl: string | null, cwd?: string) {
  if (!photoUrl || !AVATAR_URL_PATTERN.test(photoUrl)) return;
  const file = path.join(avatarsDir(cwd), path.basename(photoUrl));
  if (isPathInside(avatarsDir(cwd), file)) fs.promises.rm(file, { force: true }).catch(() => undefined);
}

/**
 * Pastikan prospek punya salinan lokal foto profil WhatsApp-nya (maks. 7 hari). Mengembalikan URL lokal,
 * foto lokal lama bila pembaruan gagal, atau null bila kontak tidak memasang foto / gateway tidak tersedia.
 * URL CDN WhatsApp tidak pernah disimpan karena bertanda tangan dan kedaluwarsa.
 */
export async function refreshProspectAvatar(prospect: AvatarProspect, options: { cwd?: string; now?: number } = {}) {
  const now = options.now ?? Date.now();
  const localCurrent = prospect.photoUrl && AVATAR_URL_PATTERN.test(prospect.photoUrl) ? prospect.photoUrl : null;
  if (!avatarNeedsRefresh(prospect.photoUrl, now)) return prospect.photoUrl;
  if (prospect.remoteJid?.endsWith('@g.us')) return localCurrent;
  const previous = lastAttempt.get(prospect.id);
  if (previous && now - previous < RETRY_AFTER_MS) return localCurrent;
  // Sudah dicek belum lama ini (tersimpan di database, bertahan setelah API restart): jangan tanya WhatsApp lagi.
  const checked = await prisma.prospect.findUnique({ where: { id: prospect.id }, select: { photoCheckedAt: true } }).catch(() => null);
  if (checked?.photoCheckedAt && now - checked.photoCheckedAt.getTime() < RETRY_AFTER_MS) return localCurrent;
  lastAttempt.set(prospect.id, now);

  const pending = throttledPerBrand(prospect.brandId, () => fetchProfilePicUrl(prospect));
  if (!pending) {
    lastAttempt.delete(prospect.id);
    return localCurrent;
  }
  const remote = await pending;
  const remoteUrl = remote.url;
  if (!remoteUrl) {
    // Kontak tanpa foto juga dicatat sudah dicek; gangguan gateway (ok: false) tidak.
    if (remote.ok) await prisma.prospect.update({ where: { id: prospect.id }, data: { photoCheckedAt: new Date(now) } }).catch(() => undefined);
    return localCurrent;
  }
  const image = await fetch(remoteUrl, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!image?.ok) return localCurrent;
  const buffer = Buffer.from(await image.arrayBuffer());
  const type = buffer.length <= MAX_AVATAR_BYTES ? detectProofType(buffer) : null;
  if (!type || type === 'pdf') return localCurrent;

  // Foto profil hanya tampil 32–40 px: disimpan 128 px WebP (±4 KB, dari rata-rata 54 KB). Bila konversi gagal,
  // berkas asli dipakai.
  const small = await shrinkAvatar(buffer);
  const dir = avatarsDir(options.cwd);
  await fs.promises.mkdir(dir, { recursive: true });
  const fileName = `p${prospect.id}-${now}-${crypto.randomBytes(6).toString('hex')}.${small ? 'webp' : type}`;
  await fs.promises.writeFile(path.join(dir, fileName), small ?? buffer);
  const photoUrl = `/uploads/avatars/${fileName}`;
  await prisma.prospect.update({ where: { id: prospect.id }, data: { photoUrl, photoCheckedAt: new Date(now) } });
  removeLocalAvatar(prospect.photoUrl, options.cwd);
  return photoUrl;
}

export async function shrinkAvatar(buffer: Buffer) {
  return sharp(buffer).rotate().resize(128, 128, { fit: 'cover' }).webp({ quality: 78 }).toBuffer().catch(() => null);
}

/** Perbarui beberapa avatar sekaligus dengan paralelisme terbatas agar gateway tidak dibanjiri. */
export async function refreshProspectAvatars(prospects: AvatarProspect[], concurrency = 4) {
  const result: Record<number, string | null> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < prospects.length) {
      const prospect = prospects[cursor++]!;
      result[prospect.id] = await refreshProspectAvatar(prospect).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, prospects.length) }, worker));
  return result;
}

/** Hanya untuk tes. */
export function resetAvatarAttempts(gapMs = 0) {
  lastAttempt.clear();
  brandQueues.clear();
  profilePicGapMs = gapMs;
}
