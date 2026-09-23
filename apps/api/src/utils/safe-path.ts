import fs from 'node:fs';
import path from 'node:path';

/**
 * True bila `candidate` berada DI DALAM `root` berdasarkan segmen path, bukan prefix string.
 * `C:\app\uploads-other\x.png` bukan bagian dari `C:\app\uploads`.
 */
export function isPathInside(root: string, candidate: string, pathImpl: typeof path = path) {
  const rel = pathImpl.relative(pathImpl.resolve(root), pathImpl.resolve(candidate));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${pathImpl.sep}`) && !pathImpl.isAbsolute(rel);
}

/** Satu-satunya bentuk flyer yang sah: hasil endpoint upload-flyer. */
export const FLYER_URL_PATTERN = /^\/uploads\/packages\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/;

/**
 * Resolve flyer paket menjadi path file nyata di `uploads/packages`. Mengembalikan null bila
 * metadata tidak berbentuk URL flyer resmi, file tidak ada, atau realpath keluar dari direktori
 * (mis. symlink).
 */
export async function resolveFlyerFile(flyerImage: string | null | undefined, cwd = process.cwd()) {
  if (!flyerImage || !FLYER_URL_PATTERN.test(flyerImage)) return null;
  const packagesRoot = path.resolve(cwd, 'uploads', 'packages');
  const candidate = path.join(packagesRoot, path.basename(flyerImage));
  if (!isPathInside(packagesRoot, candidate) || !fs.existsSync(candidate)) return null;
  const [realRoot, realCandidate] = await Promise.all([fs.promises.realpath(packagesRoot), fs.promises.realpath(candidate)]);
  if (!isPathInside(realRoot, realCandidate)) return null;
  const stat = await fs.promises.stat(realCandidate);
  return stat.isFile() ? realCandidate : null;
}

/** Media percakapan yang disimpan gateway/API: `/uploads/media/<file>` (dan lokasi lama `/uploads/chat/`). */
export const CHAT_MEDIA_URL_PATTERN = /^\/uploads\/(?:media|chat)\/[A-Za-z0-9._-]+$/;

/** Resolve mediaUrl pesan chat menjadi path file nyata di dalam `uploads/`, atau null. */
export async function resolveChatMediaFile(mediaUrl: string | null | undefined, cwd = process.cwd()) {
  if (!mediaUrl || !CHAT_MEDIA_URL_PATTERN.test(mediaUrl)) return null;
  const uploadsRoot = path.resolve(cwd, 'uploads');
  const candidate = path.join(uploadsRoot, ...mediaUrl.replace(/^\/uploads\//, '').split('/'));
  if (!isPathInside(uploadsRoot, candidate) || !fs.existsSync(candidate)) return null;
  const [realRoot, realCandidate] = await Promise.all([fs.promises.realpath(uploadsRoot), fs.promises.realpath(candidate)]);
  if (!isPathInside(realRoot, realCandidate)) return null;
  const stat = await fs.promises.stat(realCandidate);
  return stat.isFile() ? realCandidate : null;
}

/** Jenis berkas bukti bayar dari isi (magic bytes), bukan dari nama/ekstensi. */
export function detectProofType(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'pdf' | null {
  if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer.length > 12 && buffer.toString('utf8', 0, 4) === 'RIFF' && buffer.toString('utf8', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length > 4 && buffer.toString('utf8', 0, 4) === '%PDF') return 'pdf';
  return null;
}
