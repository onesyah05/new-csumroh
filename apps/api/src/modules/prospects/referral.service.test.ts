import { describe, expect, it, vi } from 'vitest';
import { attachReferralMarker, normalizeReferralMarker, storedReferral } from './referral.service.js';

describe('CTWA referral first-touch', () => {
  it('never substitutes an ad headline or source id for ctwa_clid', () => {
    const adOnly = normalizeReferralMarker({ headline: 'Paket Ramadan', adId: '123' });
    expect(adOnly).toMatchObject({ adId: '123', headline: 'Paket Ramadan' });
    expect(adOnly?.ctwaClid).toBeUndefined();
    expect(normalizeReferralMarker({ ctwaClid: 'short' })).toBeNull();
    expect(normalizeReferralMarker({ ctwaClid: 'AR-valid-click-id', headline: 'Paket Ramadan' })?.ctwaClid).toBe('AR-valid-click-id');
  });

  it('uses a conditional update so an existing marker cannot be overwritten', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const attached = await attachReferralMarker(9, { ctwaClid: 'AR-first-click', adId: 'ad-1' }, { prospect: { updateMany } } as never);
    expect(attached).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, metaReferralMarker: null }, data: expect.objectContaining({ metaReferralMarker: 'AR-first-click' }) }));
  });
});

describe('Referral without ctwa_clid', () => {
  it('records the ad origin but reports no captured click, so CAPI is not triggered', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const attached = await attachReferralMarker(9, { adId: '120250004432660412', headline: 'Travel Umroh Resmi di Depok' }, { prospect: { updateMany } } as never);
    expect(attached).toBe(false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, metaReferralMarker: null, adId: null }, data: expect.objectContaining({ adId: '120250004432660412', leadSource: 'meta_ads' }) }));
  });
});

describe('Stored referral', () => {
  it('keeps the embedded thumbnail out of meta_referral_data', () => {
    const marker = normalizeReferralMarker({ adId: '1202500', headline: 'Umroh', thumbnailBase64: '/9j/4AAQ' });
    expect(marker?.thumbnailBase64).toBe('/9j/4AAQ');
    expect(storedReferral(marker)).toEqual({ adId: '1202500', headline: 'Umroh' });
  });
});

describe('Referral source URL', () => {
  it('keeps http(s) URLs and drops other schemes without losing the ad marker', () => {
    expect(normalizeReferralMarker({ adId: '1202500', sourceUrl: 'https://fb.me/abc' })?.sourceUrl).toBe('https://fb.me/abc');
    for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'not a url']) {
      const marker = normalizeReferralMarker({ adId: '1202500', sourceUrl });
      expect(marker).toMatchObject({ adId: '1202500' });
      expect(marker?.sourceUrl).toBeUndefined();
    }
    expect(normalizeReferralMarker({ sourceUrl: 'javascript:alert(1)' })).toBeNull();
  });
});
