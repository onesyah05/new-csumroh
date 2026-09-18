import { describe, expect, it, vi } from 'vitest';
import { attachReferralMarker, normalizeReferralMarker } from './referral.service.js';

describe('CTWA referral first-touch', () => {
  it('never substitutes an ad headline or source id for ctwa_clid', () => {
    expect(normalizeReferralMarker({ headline: 'Paket Ramadan', adId: '123' })).toBeNull();
    expect(normalizeReferralMarker({ ctwaClid: 'AR-valid-click-id', headline: 'Paket Ramadan' })?.ctwaClid).toBe('AR-valid-click-id');
  });

  it('uses a conditional update so an existing marker cannot be overwritten', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const attached = await attachReferralMarker(9, { ctwaClid: 'AR-first-click', adId: 'ad-1' }, { prospect: { updateMany } } as never);
    expect(attached).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, metaReferralMarker: null }, data: expect.objectContaining({ metaReferralMarker: 'AR-first-click' }) }));
  });
});
