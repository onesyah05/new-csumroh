import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const material = { current: 'kunci-aktif-yang-cukup-panjang-0123456789', previous: '' as string | undefined };
vi.mock('../../config/env.js', () => ({
  env: {
    get META_TOKEN_ENCRYPTION_KEY() { return material.current; },
    get META_TOKEN_ENCRYPTION_KEY_PREVIOUS() { return material.previous; },
    JWT_REFRESH_SECRET: 'refresh-secret-yang-cukup-panjang-0123456789',
  },
}));

import { decryptMetaToken, encryptMetaToken, isCurrentlyEncrypted, withAdsToken } from './meta-token.js';

afterEach(() => {
  material.current = 'kunci-aktif-yang-cukup-panjang-0123456789';
  material.previous = '';
});

/** Format lama (enc:v1) tanpa id kunci, seperti yang tersimpan sebelum rotasi dibuat. */
function legacyV1(token: string, keyMaterial: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(keyMaterial).digest(), iv);
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['enc:v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

describe('Enkripsi token Meta', () => {
  it('enkripsi v2 membawa id kunci dan dapat dibaca kembali', () => {
    const encrypted = encryptMetaToken('  EAAB-token-rahasia  ');
    expect(encrypted).toMatch(/^enc:v2:[0-9a-f]{8}:/);
    expect(encrypted).not.toContain('rahasia');
    expect(decryptMetaToken(encrypted)).toBe('EAAB-token-rahasia');
    expect(isCurrentlyEncrypted(encrypted)).toBe(true);
  });

  it('nilai enc:v1 lama tetap terbaca dengan kunci aktif', () => {
    expect(decryptMetaToken(legacyV1('token-lama', material.current))).toBe('token-lama');
  });

  it('teks biasa (belum terenkripsi) dikembalikan apa adanya', () => {
    expect(decryptMetaToken('EAAB-polos')).toBe('EAAB-polos');
  });

  it('setelah rotasi: nilai lama terbaca lewat kunci lama; setelah dienkripsi ulang tidak butuh kunci lama', () => {
    const before = encryptMetaToken('token-sebelum-rotasi');
    const v1 = legacyV1('token-v1', material.current);
    material.previous = material.current;
    material.current = 'kunci-baru-yang-juga-cukup-panjang-9876543210';
    expect(decryptMetaToken(before)).toBe('token-sebelum-rotasi');
    expect(decryptMetaToken(v1)).toBe('token-v1');
    expect(isCurrentlyEncrypted(before)).toBe(false);
    const reencrypted = encryptMetaToken(decryptMetaToken(before));
    expect(isCurrentlyEncrypted(reencrypted)).toBe(true);
    material.previous = '';
    expect(decryptMetaToken(reencrypted)).toBe('token-sebelum-rotasi');
  });

  it('kunci lama sudah dihapus tetapi nilai belum dienkripsi ulang: galat yang jelas', () => {
    const before = encryptMetaToken('token-lama');
    material.current = 'kunci-baru-yang-juga-cukup-panjang-9876543210';
    expect(() => decryptMetaToken(before)).toThrow(/Kunci enkripsi untuk token ini tidak tersedia/);
  });
});

describe('Token untuk Laporan iklan', () => {
  it('memakai token ads_read khusus bila diisi', () => {
    expect(withAdsToken({ metaAccessToken: 'capi', metaAdsAccessToken: 'ads' }).metaAccessToken).toBe('ads');
  });

  it('tanpa token khusus, memakai token CAPI', () => {
    expect(withAdsToken({ metaAccessToken: 'capi', metaAdsAccessToken: null }).metaAccessToken).toBe('capi');
    expect(withAdsToken({ metaAccessToken: 'capi' }).metaAccessToken).toBe('capi');
  });
});
