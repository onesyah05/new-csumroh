import { describe, expect, it } from 'vitest';
import { isMetaSendingAllowed } from './send-guard.js';

describe('Penjaga pengiriman ke Meta', () => {
  it('production dan test boleh; development hanya dengan flag sadar', () => {
    expect(isMetaSendingAllowed('production', false)).toBe(true);
    expect(isMetaSendingAllowed('test', false)).toBe(true);
    expect(isMetaSendingAllowed('development', false)).toBe(false);
    expect(isMetaSendingAllowed('development', true)).toBe(true);
  });
});
