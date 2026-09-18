import { describe, expect, it } from 'vitest';
import { calculateDealValue, canTransitionStatus, capiEventForStatus, nextTgjpStep } from './business.js';

describe('critical business rules', () => {
  it('allows moving a prospect freely across the operational pipeline', () => {
    expect(canTransitionStatus('new', 'identifying')).toBe(true);
    expect(canTransitionStatus('new', 'closed_won')).toBe(true);
    expect(canTransitionStatus('closed_won', 'followup')).toBe(true);
  });

  it('calculates deal value from room prices and pax counts', () => {
    expect(calculateDealValue({ quad: 30_000_000, double: 36_000_000, infant: 8_000_000 }, { quad: 2, double: 1, infant: 1 })).toBe(104_000_000);
    expect(calculateDealValue({ quad: 30 }, { quad: -2 })).toBe(0);
  });

  it('advances TGJP in order', () => {
    expect(nextTgjpStep('terima')).toBe('gali');
    expect(nextTgjpStep('pastikan')).toBeNull();
  });

  it('maps conversion events', () => {
    expect(capiEventForStatus('new')).toBe('Contact');
    expect(capiEventForStatus('identifying')).toBeNull();
    expect(capiEventForStatus('closing')).toBe('InitiateCheckout');
    expect(capiEventForStatus('followup')).toBeNull();
  });
});
