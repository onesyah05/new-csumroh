import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { beforeEach } from 'vitest';
import { normalizeWhatsappImage, whatsappImageCache } from './whatsapp-image.js';

type Format = 'jpeg' | 'png' | 'webp';
const make = (format: Format, { width = 40, height = 30, channels = 3 as 3 | 4 } = {}) =>
  sharp({ create: { width, height, channels, background: channels === 4 ? { r: 200, g: 20, b: 20, alpha: 0.5 } : { r: 200, g: 20, b: 20 } } })[format]().toBuffer();
const b64 = (buffer: Buffer) => buffer.toString('base64');
const metaOf = async (base64: string) => sharp(Buffer.from(base64, 'base64')).metadata();

describe('Gambar keluar WhatsApp', () => {
  it('WebP diubah menjadi JPEG dan nama/mime ikut berubah', async () => {
    const out = await normalizeWhatsappImage({ base64: b64(await make('webp')), mimeType: 'image/webp', fileName: 'Brosur Umroh.webp' });
    expect(out).toMatchObject({ converted: true, mimeType: 'image/jpeg', fileName: 'Brosur Umroh.jpg' });
    expect((await metaOf(out.base64)).format).toBe('jpeg');
  });

  it('WebP berlabel .jpg/image/jpeg tetap dikenali dari isinya dan diubah', async () => {
    const out = await normalizeWhatsappImage({ base64: b64(await make('webp')), mimeType: 'image/jpeg', fileName: 'brosur.jpg' });
    expect(out.converted).toBe(true);
    expect((await metaOf(out.base64)).format).toBe('jpeg');
  });

  it('WebP transparan diratakan ke latar putih (bukan hitam) saat jadi JPEG', async () => {
    const out = await normalizeWhatsappImage({ base64: b64(await make('webp', { channels: 4 })), mimeType: 'image/webp', fileName: 'logo.webp' });
    const { data } = await sharp(Buffer.from(out.base64, 'base64')).raw().toBuffer({ resolveWithObject: true });
    const [red, green] = [data[0]!, data[1]!];
    expect(red).toBeGreaterThan(200); // merah 50% di atas putih tetap terang
    expect(green).toBeGreaterThan(100); // latar putih mengangkat hijau; latar hitam akan sekitar 10
  });

  it('WebP besar diperkecil ke batas sisi terpanjang, gambar kecil tidak diperbesar', async () => {
    const big = await normalizeWhatsappImage({ base64: b64(await make('webp', { width: 3200, height: 1600 })), mimeType: 'image/webp', fileName: 'besar.webp' });
    expect(await metaOf(big.base64)).toMatchObject({ width: 2560, height: 1280 });
    const small = await normalizeWhatsappImage({ base64: b64(await make('webp', { width: 40, height: 30 })), mimeType: 'image/webp', fileName: 'kecil.webp' });
    expect(await metaOf(small.base64)).toMatchObject({ width: 40, height: 30 });
  });

  it('JPEG dan PNG sah tidak diubah isinya', async () => {
    const jpeg = b64(await make('jpeg'));
    const png = b64(await make('png'));
    expect(await normalizeWhatsappImage({ base64: jpeg, mimeType: 'image/jpeg', fileName: 'a.jpg' })).toEqual({ base64: jpeg, mimeType: 'image/jpeg', fileName: 'a.jpg', converted: false });
    expect(await normalizeWhatsappImage({ base64: png, mimeType: 'image/png', fileName: 'a.png' })).toEqual({ base64: png, mimeType: 'image/png', fileName: 'a.png', converted: false });
  });

  it('mime yang salah untuk JPEG diperbaiki tanpa mengubah isi dan tidak dianggap konversi', async () => {
    const jpeg = b64(await make('jpeg'));
    const out = await normalizeWhatsappImage({ base64: jpeg, mimeType: 'image/webp', fileName: 'a.webp' });
    expect(out).toEqual({ base64: jpeg, mimeType: 'image/jpeg', fileName: 'a.webp', converted: false });
  });

  it('WebP yang gagal dikonversi dikirim apa adanya, bukan galat', async () => {
    // Header WebP sah tetapi data terpotong: metadata terbaca, decode gagal.
    const webp = await make('webp', { width: 200, height: 200 });
    const broken = b64(webp.subarray(0, 30));
    const out = await normalizeWhatsappImage({ base64: broken, mimeType: 'image/webp', fileName: 'rusak.webp' });
    expect(out.converted).toBe(false);
    expect(out.base64).toBe(broken);
  });

  it('isi yang bukan gambar dibiarkan (tidak melempar galat)', async () => {
    const out = await normalizeWhatsappImage({ base64: Buffer.from('bukan gambar').toString('base64'), mimeType: 'image/jpeg', fileName: 'x.jpg' });
    expect(out.converted).toBe(false);
    expect(out.mimeType).toBe('image/jpeg');
  });
});

describe('Batas piksel gambar masuk', () => {
  it('WebP raksasa (> 64 MP) tidak didekode: berkas asli dikirim apa adanya', async () => {
    const huge = await make('webp', { width: 9000, height: 9000 });
    const out = await normalizeWhatsappImage({ base64: b64(huge), mimeType: 'image/webp', fileName: 'bom.webp' });
    expect(out.converted).toBe(false);
    expect(out.fileName).toBe('bom.webp');
  }, 60_000);
});

describe('Cache konversi gambar keluar', () => {
  beforeEach(() => whatsappImageCache.clear());

  it('kunci yang sama memakai hasil sebelumnya tanpa mengonversi ulang', async () => {
    const first = await normalizeWhatsappImage({ base64: b64(await make('webp')), mimeType: 'image/webp', fileName: 'Brosur.webp' }, { cacheKey: 'gallery:1:100:1' });
    expect(whatsappImageCache.size()).toBe(1);
    // Isi masukan sengaja berbeda: bila hasilnya sama persis dengan yang pertama, berarti berasal dari cache.
    const second = await normalizeWhatsappImage({ base64: b64(await make('webp', { width: 200, height: 100 })), mimeType: 'image/webp', fileName: 'Lain.webp' }, { cacheKey: 'gallery:1:100:1' });
    expect(second).toEqual(first);
  });

  it('versi berkas berubah (ukuran/waktu ubah beda) berarti kunci beda dan dikonversi ulang', async () => {
    const first = await normalizeWhatsappImage({ base64: b64(await make('webp')), mimeType: 'image/webp', fileName: 'a.webp' }, { cacheKey: 'gallery:1:100:1' });
    const second = await normalizeWhatsappImage({ base64: b64(await make('webp', { width: 200, height: 100 })), mimeType: 'image/webp', fileName: 'a.webp' }, { cacheKey: 'gallery:1:100:2' });
    expect(second.base64).not.toBe(first.base64);
    expect(whatsappImageCache.size()).toBe(2);
  });

  it('tanpa kunci tidak ada yang disimpan; gambar yang tidak dikonversi juga tidak', async () => {
    await normalizeWhatsappImage({ base64: b64(await make('webp')), mimeType: 'image/webp', fileName: 'a.webp' });
    await normalizeWhatsappImage({ base64: b64(await make('jpeg')), mimeType: 'image/jpeg', fileName: 'a.jpg' }, { cacheKey: 'gallery:9:1:1' });
    expect(whatsappImageCache.size()).toBe(0);
  });
});
