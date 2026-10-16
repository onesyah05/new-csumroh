import path from 'node:path';
import sharp from 'sharp';

export type OutgoingImage = { base64: string; mimeType: string; fileName: string };

/** Format yang tidak dikirim apa adanya sebagai foto; diubah ke JPEG. */
const CONVERT_TO_JPEG = new Set(['webp', 'heif', 'tiff']);
/** Sisi terpanjang hasil konversi: cukup untuk layar HP dan mencegah JPEG raksasa dari WebP besar. */
const MAX_SIDE_PX = 2560;
const JPEG_QUALITY = 88;
/** Batas piksel gambar masuk: konversi yang melampauinya gagal dan berkas asli dikirim apa adanya. */
const MAX_INPUT_PIXELS = 64_000_000;

/**
 * Hasil konversi WebP -> JPEG untuk media yang sama (mis. brosur galeri yang dikirim ke banyak jamaah) disimpan sebentar
 * di memori, dengan kunci yang memuat id + ukuran + waktu ubah berkas. Dibatasi total ukuran; yang tertua dibuang dulu.
 */
const CACHE_MAX_BYTES = 24 * 1024 * 1024;
const convertedCache = new Map<string, { value: OutgoingImage & { converted: true }; bytes: number }>();
let convertedBytes = 0;

function rememberConverted(key: string, value: OutgoingImage & { converted: true }) {
  const bytes = value.base64.length;
  if (bytes > CACHE_MAX_BYTES / 4) return; // satu gambar tidak boleh menguasai cache
  const previous = convertedCache.get(key);
  if (previous) { convertedBytes -= previous.bytes; convertedCache.delete(key); }
  for (const [oldKey, entry] of convertedCache) {
    if (convertedBytes + bytes <= CACHE_MAX_BYTES) break;
    convertedBytes -= entry.bytes;
    convertedCache.delete(oldKey);
  }
  convertedCache.set(key, { value, bytes });
  convertedBytes += bytes;
}

/** Untuk tes. */
export const whatsappImageCache = {
  size: () => convertedCache.size,
  clear: () => { convertedCache.clear(); convertedBytes = 0; },
};

/**
 * WhatsApp menyampaikan foto JPEG/PNG. Di production, gambar WebP (galeri media, flyer paket, atau berkas ".jpg"
 * yang isinya WebP) berhenti di centang satu dan tidak sampai ke HP penerima, sedangkan JPEG sampai normal.
 * Format ditentukan dari isi berkas, bukan dari ekstensi atau mime yang dikirim klien.
 *
 * - `mimeType` selalu mengikuti isi (JPEG/PNG) bila terdeteksi.
 * - `converted` true hanya bila isi di-encode ulang; saat itu `base64` dan `fileName` juga berubah, sehingga salinan
 *   lokal di CRM harus ikut diganti. Bila konversi gagal, gambar asli dikirim apa adanya (perilaku sebelumnya).
 */
export async function normalizeWhatsappImage(input: OutgoingImage, options: { cacheKey?: string } = {}): Promise<OutgoingImage & { converted: boolean }> {
  const cached = options.cacheKey ? convertedCache.get(options.cacheKey) : undefined;
  if (cached) return { ...cached.value };
  const buffer = Buffer.from(input.base64, 'base64');
  const meta = await sharp(buffer).metadata().catch(() => null);
  const format = meta?.format;

  if (format === 'jpeg') return { ...input, mimeType: 'image/jpeg', converted: false };
  if (format === 'png') return { ...input, mimeType: 'image/png', converted: false };
  // GIF dan format tak dikenal dibiarkan: bukan kasus yang diperbaiki di sini.
  if (!format || !CONVERT_TO_JPEG.has(format)) return { ...input, converted: false };

  try {
    const jpeg = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    const stem = path.parse(input.fileName).name || 'foto';
    const result = { base64: jpeg.toString('base64'), mimeType: 'image/jpeg', fileName: `${stem}.jpg`, converted: true as const };
    if (options.cacheKey) rememberConverted(options.cacheKey, result);
    return result;
  } catch (error) {
    console.warn('Konversi gambar ke JPEG gagal, mengirim berkas asli:', error);
    return { ...input, converted: false };
  }
}
