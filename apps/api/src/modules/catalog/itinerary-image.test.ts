import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ITINERARY_CANVAS, itineraryDateText, renderItineraryGuide, renderItineraryImage } from './itinerary-image.js';

const blankTemplate = () => sharp({ create: { width: ITINERARY_CANVAS.width, height: ITINERARY_CANVAS.height, channels: 3, background: '#ffffff' } }).png().toBuffer();

describe('itinerary-image', { timeout: 30_000 }, () => {
  it('merender 1080×1350 dan menandai bila agenda tidak muat', async () => {
    const template = await blankTemplate();
    const short = await renderItineraryImage(template, { name: 'Paket Uji', dateText: 'Berangkat 1 Januari 2027', itinerary: 'Hari 1: Berangkat\nHari 2: Tiba' });
    const meta = await sharp(short.image).metadata();
    expect([meta.width, meta.height]).toEqual([ITINERARY_CANVAS.width, ITINERARY_CANVAS.height]);
    expect(short.truncated).toBe(false);

    const long = await renderItineraryImage(template, { name: 'Paket Uji', dateText: '', itinerary: Array.from({ length: 40 }, (_, i) => `Hari ${i + 1}: ${'agenda panjang '.repeat(12)}`).join('\n') });
    expect(long.truncated).toBe(true);
    expect((await sharp(long.image).metadata()).height).toBe(ITINERARY_CANVAS.height);
  });

  it('karakter markup di teks paket tidak merusak render', async () => {
    const { image } = await renderItineraryImage(await blankTemplate(), { name: 'A & B <Umroh>', dateText: '', itinerary: 'Hari 1: Tiba <b>di</b> Madinah & istirahat' });
    expect((await sharp(image).metadata()).width).toBe(ITINERARY_CANVAS.width);
  });

  it('panduan designer berukuran sama dengan kanvas', async () => {
    expect((await sharp(await renderItineraryGuide()).metadata()).height).toBe(ITINERARY_CANVAS.height);
  });

  it('teks tanggal dari departureDate, cadangan departureInfo', () => {
    expect(itineraryDateText({ departureDate: new Date('2026-10-15T00:00:00Z'), duration: '9 Hari' })).toBe('Berangkat 15 Oktober 2026 · 9 Hari');
    expect(itineraryDateText({ departureDate: null, departureInfo: 'Akhir Oktober', duration: null })).toBe('Berangkat Akhir Oktober');
  });
});

describe('itineraryFits', { timeout: 30_000 }, () => {
  it('menolak itinerary yang tidak muat dan menerima yang muat', async () => {
    const { itineraryFits } = await import('./itinerary-image.js');
    expect(await itineraryFits('Hari 1: Berangkat\nHari 2: Tiba')).toBe(true);
    expect(await itineraryFits(Array.from({ length: 14 }, (_, i) => `Hari ${i + 1}: ${'agenda panjang '.repeat(10)}`).join('\n'))).toBe(false);
  });
});
