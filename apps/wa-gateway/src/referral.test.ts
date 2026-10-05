import { describe, expect, it } from 'vitest';
import { extractMetaReferral } from './referral.js';

describe('Baileys CTWA referral extraction', () => {
  it('extracts click id separately from ad metadata', () => {
    const message = { message: { extendedTextMessage: { contextInfo: { externalAdReply: { ctwaClid: 'AR-click-id', sourceId: 'ad-123', title: 'Umroh Ramadan', sourceUrl: 'https://example.com/ad' } } } } };
    expect(extractMetaReferral(message as never)).toEqual({ ctwaClid: 'AR-click-id', adId: 'ad-123', headline: 'Umroh Ramadan', sourceUrl: 'https://example.com/ad' });
  });

  it('keeps the ad body and full-size image for the chat ad card', () => {
    const ad = { ctwaClid: 'AR-click-id', sourceId: '120250004432660412', title: 'Umroh Desember', body: 'Promo paket 29jt', thumbnailUrl: 'https://scontent.fbcdn.net/small.jpg', originalImageUrl: 'https://scontent.fbcdn.net/full.jpg' };
    const message = { message: { extendedTextMessage: { contextInfo: { externalAdReply: ad } } } };
    expect(extractMetaReferral(message as never)).toMatchObject({ headline: 'Umroh Desember', body: 'Promo paket 29jt', thumbnailUrl: 'https://scontent.fbcdn.net/full.jpg' });
  });

  it('does not promote a headline or source id into ctwa_clid', () => {
    const message = { message: { extendedTextMessage: { contextInfo: { externalAdReply: { sourceId: 'ad-123', title: 'Umroh Ramadan' } } } } };
    expect(extractMetaReferral(message as never)?.ctwaClid).toBeUndefined();
  });
  it('finds the ad context on any message type', () => {
    const message = { message: { templateButtonReplyMessage: { contextInfo: { externalAdReply: { sourceId: '120250004432660412', title: 'Travel Umroh Resmi di Depok' } } } } };
    expect(extractMetaReferral(message as never)).toMatchObject({ adId: '120250004432660412', headline: 'Travel Umroh Resmi di Depok' });
  });
  it('forwards the embedded JPEG thumbnail, like the blurred image Pancake shows', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    const message = { message: { extendedTextMessage: { contextInfo: { externalAdReply: { sourceId: '120250004432660412', title: 'Travel Umroh Resmi di Depok', thumbnail: jpeg } } } } };
    expect(extractMetaReferral(message as never)?.thumbnailBase64).toBe(Buffer.from(jpeg).toString('base64'));
  });
});
