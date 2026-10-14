import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

const PREFIX_V1 = 'enc:v1';
const PREFIX_V2 = 'enc:v2';

type KeyEntry = { id: string; key: Buffer };

const entry = (material: string): KeyEntry => ({
  // Id pendek untuk memilih kunci saat membaca; bukan rahasia dan tidak dapat dibalik ke kunci.
  id: createHash('sha256').update(`key-id:${material}`).digest('hex').slice(0, 8),
  key: createHash('sha256').update(material).digest(),
});

/** Kunci aktif lebih dulu, lalu kunci lama (META_TOKEN_ENCRYPTION_KEY_PREVIOUS) agar nilai lama tetap terbaca. */
function keyring(): KeyEntry[] {
  const current = env.META_TOKEN_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET;
  const previous = (env.META_TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return [current, ...previous].map(entry);
}

export function encryptMetaToken(token: string) {
  const [active] = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', active!.key, iv);
  const ciphertext = Buffer.concat([cipher.update(token.trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX_V2, active!.id, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

function open(key: Buffer, ivValue: string, tagValue: string, ciphertextValue: string) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}

export function decryptMetaToken(value: string) {
  const keys = keyring();
  if (value.startsWith(`${PREFIX_V2}:`)) {
    const [, , id, ivValue, tagValue, ciphertextValue] = value.split(':');
    if (!id || !ivValue || !tagValue || !ciphertextValue) throw new Error('Format token Meta terenkripsi tidak valid.');
    const match = keys.find((item) => item.id === id);
    if (!match) throw new Error('Kunci enkripsi untuk token ini tidak tersedia (lihat META_TOKEN_ENCRYPTION_KEY_PREVIOUS).');
    return open(match.key, ivValue, tagValue, ciphertextValue);
  }
  if (!value.startsWith(`${PREFIX_V1}:`)) return value;
  const [, , ivValue, tagValue, ciphertextValue] = value.split(':');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Format token Meta terenkripsi tidak valid.');
  // v1 tanpa id kunci: coba kunci aktif lalu kunci lama.
  let lastError: unknown;
  for (const item of keys) {
    try {
      return open(item.key, ivValue, tagValue, ciphertextValue);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Token Meta terenkripsi tidak dapat dibaca.');
}

/** Nilai sudah memakai kunci aktif dan format terbaru? Dipakai skrip enkripsi ulang setelah rotasi. */
export function isCurrentlyEncrypted(value: string) {
  const [active] = keyring();
  return value.startsWith(`${PREFIX_V2}:${active!.id}:`);
}

/** Enkripsi rahasia lain milik aplikasi (mis. kunci API Asisten AI) memakai kunci dan format yang sama. */
export const encryptSecret = encryptMetaToken;
export const decryptSecret = decryptMetaToken;

export function maskMetaToken(value: string | null) {
  if (!value) return null;
  return '••••••••••••••••';
}

/**
 * Token untuk membaca & mengelola iklan (Laporan, audiens spam): token ads_read khusus bila diisi, selain itu token
 * CAPI. Token CAPI dari Events Manager hanya boleh mengirim event, tidak boleh membaca ad account.
 */
export function withAdsToken<T extends { metaAccessToken: string | null; metaAdsAccessToken?: string | null }>(brand: T) {
  return { ...brand, metaAccessToken: brand.metaAdsAccessToken || brand.metaAccessToken };
}
