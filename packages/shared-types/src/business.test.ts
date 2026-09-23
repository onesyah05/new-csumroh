import { describe, expect, it } from 'vitest';
import {
  businessDateKey,
  canonicalStatus,
  calculateDealValue,
  canTransitionStatus,
  capiEventForStatus,
  dateOnlyKey,
  nextTgjpStep,
  packageBookingValue,
  seatCountFor,
} from './business.js';

describe('critical business rules', () => {
  it('allows moving a prospect freely across the operational pipeline', () => {
    expect(canTransitionStatus('new', 'identifying')).toBe(true);
    expect(canTransitionStatus('new', 'closed_won')).toBe(true);
    expect(canTransitionStatus('followup', 'qualified')).toBe(true);
  });

  it('never moves a verified deal back into the pipeline; only cancellation', () => {
    expect(canTransitionStatus('closed_won', 'followup')).toBe(false);
    expect(canTransitionStatus('deal', 'offer')).toBe(false);
    expect(canTransitionStatus('deal', 'closing')).toBe(false);
    expect(canTransitionStatus('deal', 'lose')).toBe(true);
    expect(canTransitionStatus('deal', 'deal')).toBe(true);
  });

  it('maps legacy statuses onto canonical Kanban columns', () => {
    expect(canonicalStatus('closed_won')).toBe('deal');
    expect(canonicalStatus('offered')).toBe('offer');
    expect(canonicalStatus('nurture')).toBe('followup');
    expect(canonicalStatus('closing')).toBe('closing');
  });

  it('reads DATE columns and business dates consistently in WIB', () => {
    expect(dateOnlyKey(new Date('2026-09-23T00:00:00.000Z'))).toBe('2026-09-23');
    expect(dateOnlyKey('2026-09-23T00:00:00.000Z')).toBe('2026-09-23');
    expect(dateOnlyKey(String(new Date('2026-09-23T00:00:00.000Z')))).toBeNull();
    // 23:30 UTC on the 22nd is already the 23rd in Jakarta (UTC+7)
    expect(businessDateKey(new Date('2026-09-22T23:30:00.000Z'))).toBe('2026-09-23');
    expect(businessDateKey(new Date('2026-09-23T16:59:00.000Z'))).toBe('2026-09-23');
    expect(businessDateKey(new Date('2026-09-23T17:00:00.000Z'))).toBe('2026-09-24');
  });

  it('prices a booking from the catalog and counts seats without infants', () => {
    const pkg = { price: 'Rp 30.000.000', priceDouble: 'Rp 36.000.000', priceInfant: '8.000.000' };
    expect(packageBookingValue(pkg, { paxQuad: 2, paxDouble: 1, paxInfant: 1 })).toBe(104_000_000);
    expect(packageBookingValue({ price: '' }, { paxQuad: 2 })).toBe(0);
    expect(seatCountFor({ paxQuad: 2, paxDouble: 1 })).toBe(3);
    expect(seatCountFor({})).toBe(1);
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
    expect(capiEventForStatus('contact')).toBe('Contact');
    expect(capiEventForStatus('identifying')).toBeNull();
    expect(capiEventForStatus('offer')).toBe('AddToCart');
    expect(capiEventForStatus('closing')).toBe('InitiateCheckout');
    expect(capiEventForStatus('deal')).toBe('Purchase');
    expect(capiEventForStatus('followup')).toBeNull();
    expect(capiEventForStatus('lose')).toBeNull();
  });
});
