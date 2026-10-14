import path from 'node:path';
import sharp from 'sharp';

export type OutgoingImage = { base64: string; mimeType: string; fileName: string };

/** Format yang tidak dikirim apa adanya sebagai foto; diubah ke JPEG. */
const CONVERT_TO_JPEG = new Set(['webp', 'heif', 'tiff']);
/** Sisi terpanjang hasil konversi: cukup untuk layar HP dan mencegah JPEG raksasa dari WebP besar. */
const MAX_SIDE_PX = 2560;
const JPEG_QUALITY = 88;

/**
 * WhatsApp menyampaikan foto JPEG/PNG. Di production, gambar WebP (galeri media, flyer paket, atau berkas ".jpg"
 * yang isinya WebP) berhenti di centang satu dan tidak sampai ke HP penerima, sedangkan JPEG sampai normal.
 * Format ditentukan dari isi berkas, bukan dari ekstensi atau mime yang dikirim klien.
 *
 * - `mimeType` selalu mengikuti isi (JPEG/PNG) bila terdeteksi.
 * - `converted` true hanya bila isi di-encode ulang; saat itu `base64` dan `fileName` juga berubah, sehingga salinan
 *   lokal di CRM harus ikut diganti. Bila konversi gagal, gambar asli dikirim apa adanya (perilaku sebelumnya).
 */
export async function normalizeWhatsappImage(input: OutgoingImage): Promise<OutgoingImage & { converted: boolean }> {
  const buffer = Buffer.from(input.base64, 'base64');
  const meta = await sharp(buffer).metadata().catch(() => null);
  const format = meta?.format;

  if (format === 'jpeg') return { ...input, mimeType: 'image/jpeg', converted: false };
  if (format === 'png') return { ...input, mimeType: 'image/png', converted: false };
  // GIF dan format tak dikenal dibiarkan: bukan kasus yang diperbaiki di sini.
  if (!format || !CONVERT_TO_JPEG.has(format)) return { ...input, converted: false };

  try {
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    const stem = path.parse(input.fileName).name || 'foto';
    return { base64: jpeg.toString('base64'), mimeType: 'image/jpeg', fileName: `${stem}.jpg`, converted: true };
  } catch (error) {
    console.warn('Konversi gambar ke JPEG gagal, mengirim berkas asli:', error);
    return { ...input, converted: false };
  }
}
