import type { GalleryAsset } from '../gallery/galleryApi';

export type BatchQuote = { messageId: string; text?: string | null; senderName?: string | null };

export type BatchDeps = {
  /** Kirim satu media ke chat (POST /chat/messages/media). */
  post(body: Record<string, unknown>): Promise<unknown>;
  /** Id acak untuk kunci idempotensi satu media. */
  newId(): string;
};

export type BatchResult = { sent: GalleryAsset[]; failed: GalleryAsset[]; quoteUsed: boolean };

/**
 * Kirim media pilihan galeri satu per satu sesuai urutan (tiap media satu pesan WhatsApp, tanpa keterangan).
 * - Hanya id media yang dikirim; server membaca berkas galerinya sendiri (tanpa unduh dan unggah ulang lewat browser).
 * - Kutipan balasan hanya menempel di media pertama yang berhasil terkirim.
 * - Tiap media punya `clientId` yang disimpan di `clientIds` sampai berhasil: coba ulang media yang sama memakai id yang sama,
 *   sehingga server tidak mengirim dobel bila percobaan sebelumnya sebenarnya sudah sampai (habis waktu di browser).
 * - Media yang gagal dikembalikan di `failed` agar bisa dicoba lagi; tidak menghentikan media berikutnya.
 */
export async function sendGalleryBatch(input: {
  assets: GalleryAsset[];
  base: { brandId: number; prospectId: number };
  quote?: BatchQuote | null;
  clientIds: Map<number, string>;
  deps: BatchDeps;
  onProgress?(done: number, total: number): void;
}): Promise<BatchResult> {
  const { assets, base, quote, clientIds, deps, onProgress } = input;
  const sent: GalleryAsset[] = [];
  const failed: GalleryAsset[] = [];
  let quoteUsed = false;
  for (const [index, asset] of assets.entries()) {
    try {
      const clientId = clientIds.get(asset.id) ?? deps.newId();
      clientIds.set(asset.id, clientId);
      await deps.post({
        ...base,
        clientId,
        galleryAssetId: asset.id,
        fileName: asset.name,
        mimeType: asset.mimeType,
        mediaType: asset.mimeType.startsWith('video/') ? 'videoMessage' : 'imageMessage',
        caption: '',
        ...(quote && !quoteUsed ? { quotedMessageId: quote.messageId, quotedText: quote.text ?? undefined, quotedSender: quote.senderName ?? undefined } : {}),
      });
      clientIds.delete(asset.id);
      quoteUsed = true;
      sent.push(asset);
    } catch {
      failed.push(asset);
    }
    onProgress?.(index + 1, assets.length);
  }
  return { sent, failed, quoteUsed };
}
