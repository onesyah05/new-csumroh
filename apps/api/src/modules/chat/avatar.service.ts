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

async function fetchProfilePicUrl(prospect: AvatarProspect) {
  const params = new URLSearchParams();
  if (prospect.remoteJid) params.set('jid', prospect.remoteJid);
  if (prospect.phone) params.set('phone', prospect.phone);
  const response = await fetch(`${env.WA_GATEWAY_URL}/sessions/${prospect.brandId}/profile-pic?${params.toString()}`, {
    headers: { 'x-internal-secret': env.WA_GATEWAY_SECRET },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null) as { data?: { url?: string | null } } | null;
  const url = body?.data?.url;
  return url && /^https:\/\//.test(url) ? url : null;
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
  lastAttempt.set(prospect.id, now);

  const remoteUrl = await fetchProfilePicUrl(prospect);
  if (!remoteUrl) return localCurrent;
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
  await prisma.prospect.update({ where: { id: prospect.id }, data: { photoUrl } });
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
export function resetAvatarAttempts() {
  lastAttempt.clear();
}
