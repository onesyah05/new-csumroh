import { describe, expect, it } from 'vitest';
import { phoneSearchDigits } from './phone-search.js';

describe('Pencarian nomor', () => {
  it('format lokal 08… tetap cocok dengan nomor tersimpan 62…', () => {
    expect(phoneSearchDigits('0812 3456')).toBe('8123456');
    expect('628123456789'.includes(phoneSearchDigits('0812-3456')!)).toBe(true);
    expect(phoneSearchDigits('+62 812 3456')).toBe('628123456');
  });

  it('kurang dari 4 digit bukan pencarian nomor', () => {
    expect(phoneSearchDigits('Budi')).toBeNull();
    expect(phoneSearchDigits('012')).toBeNull();
  });
});
