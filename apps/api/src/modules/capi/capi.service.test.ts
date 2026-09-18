import { describe, expect, it } from 'vitest';
import { buildCapiPayload, normalizePhone, sha256 } from './capi.payload.js';

describe('Meta CAPI payload builder',()=>{
  it('normalizes Indonesian phone numbers',()=>{expect(normalizePhone('0812-3456-7890')).toBe('6281234567890');expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890');});
  it('never exposes raw phone in payload',()=>{const payload=buildCapiPayload({eventName:'Purchase',eventId:'event-1',phone:'081234567890',value:50_000_000});const serialized=JSON.stringify(payload);expect(serialized).not.toContain('081234567890');expect(serialized).toContain(sha256('6281234567890'));expect(payload.data[0]!.custom_data).toEqual({currency:'IDR',value:50_000_000});});
});
