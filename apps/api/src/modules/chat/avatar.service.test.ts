import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { prospect: { update: mocks.update } } }));

import { refreshProspectAvatar, resetAvatarAttempts } from './avatar.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const base = { id: 7, brandId: 1, remoteJid: '62811@s.whatsapp.net', phone: '62811', photoUrl: null as string | null };
let cwd = '';

function stubNetwork(opts: { gatewayUrl?: string | null; image?: Buffer; gatewayOk?: boolean }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/profile-pic')) {
      return { ok: opts.gatewayOk ?? true, json: async () => ({ data: { url: opts.gatewayUrl ?? null } }) } as Response;
    }
    return { ok: true, arrayBuffer: async () => Uint8Array.from(opts.image ?? JPEG).buffer } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-'));
  resetAvatarAttempts();
  mocks.update.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('Foto profil WhatsApp', () => {
  it('menyalin foto ke server dan menyimpan URL lokal, bukan URL CDN WhatsApp', async () => {
    stubNetwork({ gatewayUrl: 'https://pps.whatsapp.net/v/t61/abc.jpg?oe=123' });
    const url = await refreshProspectAvatar({ ...base }, { cwd, now: 1_790_000_000_000 });
    expect(url).toMatch(/^\/uploads\/avatars\/p7-1790000000000-[a-f0-9]+\.jpg$/);
    expect(fs.readFileSync(path.join(cwd, 'uploads', 'avatars', path.basename(url!))).equals(JPEG)).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { photoUrl: url } });
  });

  it('URL CDN lama yang tersimpan dianggap basi dan diganti salinan lokal', async () => {
    stubNetwork({ gatewayUrl: 'https://pps.whatsapp.net/v/new.jpg' });
    const url = await refreshProspectAvatar({ ...base, photoUrl: 'https://pps.whatsapp.net/v/old.jpg?oe=1' }, { cwd });
    expect(url).toMatch(/^\/uploads\/avatars\//);
  });

  it('foto lokal yang masih segar dipakai apa adanya tanpa memanggil gateway', async () => {
    const fetchMock = stubNetwork({});
    const fresh = `/uploads/avatars/p7-${Date.now()}-abcdef.jpg`;
    expect(await refreshProspectAvatar({ ...base, photoUrl: fresh }, { cwd })).toBe(fresh);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kontak tanpa foto → null (siluet di UI), dan tidak dicoba ulang terus-menerus', async () => {
    const fetchMock = stubNetwork({ gatewayUrl: null });
    expect(await refreshProspectAvatar({ ...base }, { cwd })).toBeNull();
    expect(await refreshProspectAvatar({ ...base }, { cwd })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('menolak isi yang bukan gambar', async () => {
    stubNetwork({ gatewayUrl: 'https://pps.whatsapp.net/x', image: Buffer.from('<html>not an image</html>') });
    expect(await refreshProspectAvatar({ ...base }, { cwd })).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
