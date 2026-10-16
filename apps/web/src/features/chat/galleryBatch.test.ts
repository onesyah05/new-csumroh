// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { GalleryAsset } from '../gallery/galleryApi';
import { sendGalleryBatch } from './galleryBatch';

const asset = (id: number, mimeType = 'image/webp'): GalleryAsset => ({
  id, brandId: 1, folderId: null, name: `Foto ${id}`, url: `/u/${id}`, mimeType, size: 10, width: 1, height: 1, createdAt: '2026-10-16T00:00:00Z', uploadedBy: null,
});

function setup(options: { failIds?: number[] } = {}) {
  const posts: Record<string, any>[] = [];
  let counter = 0;
  const deps = {
    toFile: async (a: GalleryAsset) => new File([`isi-${a.id}`], `${a.name}.${a.mimeType === 'video/mp4' ? 'mp4' : 'webp'}`, { type: a.mimeType }),
    post: vi.fn(async (body: Record<string, any>) => {
      const id = Number(String(body.fileName).match(/\d+/)![0]);
      if (options.failIds?.includes(id)) throw new Error('gateway putus');
      posts.push(body);
    }),
    newId: () => `client-id-${++counter}`,
  };
  return { posts, deps };
}
const base = { brandId: 1, prospectId: 9 };

describe('Kirim media pilihan galeri', () => {
  it('mengirim berurutan, satu pesan per media, tanpa caption, dengan tipe sesuai', async () => {
    const { posts, deps } = setup();
    const progress: string[] = [];
    const result = await sendGalleryBatch({
      assets: [asset(1), asset(2, 'video/mp4'), asset(3)], base, clientIds: new Map(), deps,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(posts.map((p) => p.fileName)).toEqual(['Foto 1.webp', 'Foto 2.mp4', 'Foto 3.webp']);
    expect(posts.map((p) => p.mediaType)).toEqual(['imageMessage', 'videoMessage', 'imageMessage']);
    expect(posts.every((p) => p.caption === '' && p.prospectId === 9 && p.brandId === 1)).toBe(true);
    expect(posts[0]!.base64Data).toBe(btoa('isi-1'));
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
    expect(result.failed).toEqual([]);
    expect(result.sent).toHaveLength(3);
  });

  it('kutipan balasan hanya menempel di media pertama', async () => {
    const { posts, deps } = setup();
    const result = await sendGalleryBatch({
      assets: [asset(1), asset(2)], base, clientIds: new Map(), deps,
      quote: { messageId: 'WAMSG1', text: 'Berapa harganya?', senderName: 'Ibu Aisyah' },
    });
    expect(posts[0]).toMatchObject({ quotedMessageId: 'WAMSG1', quotedText: 'Berapa harganya?', quotedSender: 'Ibu Aisyah' });
    expect(posts[1]).not.toHaveProperty('quotedMessageId');
    expect(result.quoteUsed).toBe(true);
  });

  it('bila media pertama gagal, kutipan pindah ke media pertama yang berhasil', async () => {
    const { posts, deps } = setup({ failIds: [1] });
    const result = await sendGalleryBatch({ assets: [asset(1), asset(2)], base, clientIds: new Map(), deps, quote: { messageId: 'WAMSG1' } });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ fileName: 'Foto 2.webp', quotedMessageId: 'WAMSG1' });
    expect(result.failed.map((a) => a.id)).toEqual([1]);
  });

  it('satu media gagal tidak menghentikan yang lain; yang gagal dikembalikan untuk dicoba lagi', async () => {
    const { posts, deps } = setup({ failIds: [2] });
    const result = await sendGalleryBatch({ assets: [asset(1), asset(2), asset(3)], base, clientIds: new Map(), deps });
    expect(posts.map((p) => p.fileName)).toEqual(['Foto 1.webp', 'Foto 3.webp']);
    expect(result.failed.map((a) => a.id)).toEqual([2]);
  });

  it('coba ulang media yang gagal memakai clientId yang sama (server tidak mengirim dobel); yang berhasil melepas id-nya', async () => {
    const clientIds = new Map<number, string>();
    const first = setup({ failIds: [2] });
    await sendGalleryBatch({ assets: [asset(1), asset(2)], base, clientIds, deps: first.deps });
    const failedId = first.deps.post.mock.calls.map((c) => c[0]).find((b) => b.fileName === 'Foto 2.webp')!.clientId;
    expect([...clientIds.keys()]).toEqual([2]); // hanya yang gagal masih menyimpan id

    const retry = setup();
    await sendGalleryBatch({ assets: [asset(2)], base, clientIds, deps: retry.deps });
    expect(retry.posts[0]!.clientId).toBe(failedId);
    expect(clientIds.size).toBe(0);
  });

  it('tiap media dalam satu kiriman punya clientId berbeda', async () => {
    const { posts, deps } = setup();
    await sendGalleryBatch({ assets: [asset(1), asset(2)], base, clientIds: new Map(), deps });
    expect(new Set(posts.map((p) => p.clientId)).size).toBe(2);
  });

  it('gagal mengunduh dari galeri dihitung gagal tanpa memanggil kirim', async () => {
    const { deps } = setup();
    deps.toFile = async () => { throw new Error('404'); };
    const result = await sendGalleryBatch({ assets: [asset(1)], base, clientIds: new Map(), deps });
    expect(deps.post).not.toHaveBeenCalled();
    expect(result.failed).toHaveLength(1);
  });
});
