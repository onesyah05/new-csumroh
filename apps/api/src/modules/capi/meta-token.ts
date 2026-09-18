import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

const PREFIX = 'enc:v1';

function encryptionKey() {
  const material = env.META_TOKEN_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET;
  return createHash('sha256').update(material).digest();
}

export function encryptMetaToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token.trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptMetaToken(value: string) {
  if (!value.startsWith(`${PREFIX}:`)) return value;
  const [, , ivValue, tagValue, ciphertextValue] = value.split(':');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Format token Meta terenkripsi tidak valid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}

export function maskMetaToken(value: string | null) {
  if (!value) return null;
  return '••••••••••••••••';
}
