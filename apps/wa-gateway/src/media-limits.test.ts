import { describe, expect, it } from 'vitest';
import { declaredMediaBytes, exceedsMediaLimit, MAX_INBOUND_MEDIA_BYTES } from './media-limits.js';

describe('batas media masuk', () => {
  it('membaca ukuran yang dinyatakan: number, string, dan Long protobuf', () => {
    expect(declaredMediaBytes({ documentMessage: { fileLength: 1024 } }, 'documentMessage')).toBe(1024);
    expect(declaredMediaBytes({ documentMessage: { fileLength: '2048' } }, 'documentMessage')).toBe(2048);
    expect(declaredMediaBytes({ videoMessage: { fileLength: { toNumber: () => 5_000_000 } } }, 'videoMessage')).toBe(5_000_000);
    // Long tanpa toNumber: 1 GB = high 0, low 1073741824
    expect(declaredMediaBytes({ documentMessage: { fileLength: { low: 1_073_741_824, high: 0 } } }, 'documentMessage')).toBe(1_073_741_824);
    expect(declaredMediaBytes({ documentMessage: { fileLength: { low: 0, high: 1 } } }, 'documentMessage')).toBe(2 ** 32);
  });

  it('tidak dinyatakan atau tidak terbaca: null (batas dicek lagi pada hasil unduhan)', () => {
    expect(declaredMediaBytes({ imageMessage: {} }, 'imageMessage')).toBeNull();
    expect(declaredMediaBytes({}, 'imageMessage')).toBeNull();
    expect(declaredMediaBytes(null, 'imageMessage')).toBeNull();
    expect(declaredMediaBytes({ imageMessage: { fileLength: 'abc' } }, 'imageMessage')).toBeNull();
  });

  it('melewati batas hanya bila ukuran diketahui dan lebih besar', () => {
    expect(exceedsMediaLimit(null)).toBe(false);
    expect(exceedsMediaLimit(MAX_INBOUND_MEDIA_BYTES)).toBe(false);
    expect(exceedsMediaLimit(MAX_INBOUND_MEDIA_BYTES + 1)).toBe(true);
    expect(exceedsMediaLimit(10, 5)).toBe(true);
  });
});
