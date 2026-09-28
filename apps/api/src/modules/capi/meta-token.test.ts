import { describe, expect, it } from 'vitest';
import { withAdsToken } from './meta-token.js';

describe('Token untuk Laporan iklan', () => {
  it('memakai token ads_read khusus bila diisi', () => {
    expect(withAdsToken({ metaAccessToken: 'capi', metaAdsAccessToken: 'ads' }).metaAccessToken).toBe('ads');
  });

  it('tanpa token khusus, memakai token CAPI', () => {
    expect(withAdsToken({ metaAccessToken: 'capi', metaAdsAccessToken: null }).metaAccessToken).toBe('capi');
    expect(withAdsToken({ metaAccessToken: 'capi' }).metaAccessToken).toBe('capi');
  });
});
