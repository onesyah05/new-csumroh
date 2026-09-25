import { describe, expect, it } from 'vitest';
import { interpolateScript, transformScriptTree } from './interpolate.js';

describe('script interpolation', () => {
  it('normalizes the agent point of view and interpolates known variables', () => {
    expect(interpolateScript('Saya {{agent_name}}, agen resmi {{travel}}. Paket {{paket}}.', {
      cs_name: 'Fitri', travel: 'Hana Tours', paket: 'Ramadan',
    })).toBe('Saya Fitri, tim layanan jamaah Hana Tours. Paket Ramadan.');
  });

  it('keeps missing tokens visible and transforms nested JSON safely', () => {
    expect(transformScriptTree({ items: ['DP ke {{rekening}}', '{{paket}}'] }, { paket: 'Ramadan' }))
      .toEqual({ items: ['DP ke {{rekening}}', 'Ramadan'] });
  });
});
