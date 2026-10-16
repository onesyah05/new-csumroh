import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FLYER_URL_PATTERN, GALLERY_URL_PATTERN, isPathInside, resolveGalleryFile } from './safe-path.js';

describe('path containment (R08)', () => {
  it('rejects a sibling directory that merely shares the prefix', () => {
    expect(isPathInside('C:\\audit\\uploads', 'C:\\audit\\uploads-other\\example.png', path.win32)).toBe(false);
    expect(isPathInside('/srv/uploads', '/srv/uploads-other/example.png', path.posix)).toBe(false);
  });

  it('rejects traversal and the root itself, accepts real children', () => {
    expect(isPathInside('C:\\audit\\uploads', 'C:\\audit\\uploads\\..\\secret.txt', path.win32)).toBe(false);
    expect(isPathInside('C:\\audit\\uploads', 'C:\\audit\\uploads', path.win32)).toBe(false);
    expect(isPathInside('C:\\audit\\uploads', 'D:\\uploads\\x.png', path.win32)).toBe(false);
    expect(isPathInside('C:\\audit\\uploads', 'C:\\audit\\uploads\\packages\\flyer.png', path.win32)).toBe(true);
    expect(isPathInside('/srv/uploads', '/srv/uploads/..flyer.png', path.posix)).toBe(true);
  });

  it('only accepts flyer URLs produced by the upload endpoint', () => {
    expect(FLYER_URL_PATTERN.test('/uploads/packages/flyer-1726000000-abc123.png')).toBe(true);
    expect(FLYER_URL_PATTERN.test('C:\\audit\\uploads-other\\example.png')).toBe(false);
    expect(FLYER_URL_PATTERN.test('/uploads/packages/../../.env')).toBe(false);
    expect(FLYER_URL_PATTERN.test('/uploads/media/chat.pdf')).toBe(false);
  });
});

describe('berkas media galeri', () => {
  let cwd: string;
  let gallery: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'galeri-'));
    gallery = path.join(cwd, 'uploads', 'gallery');
    fs.mkdirSync(gallery, { recursive: true });
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('hanya menerima url hasil unggah galeri (webp/mp4 di folder galeri)', () => {
    expect(GALLERY_URL_PATTERN.test('/uploads/gallery/g1-1790000000000-0123456789abcdef.webp')).toBe(true);
    expect(GALLERY_URL_PATTERN.test('/uploads/gallery/g1-1790000000000-0123456789abcdef.mp4')).toBe(true);
    expect(GALLERY_URL_PATTERN.test('/uploads/gallery/../../.env')).toBe(false);
    expect(GALLERY_URL_PATTERN.test('/uploads/media/g1-1-aa.mp4')).toBe(false);
    expect(GALLERY_URL_PATTERN.test('/uploads/gallery/rahasia.exe')).toBe(false);
  });

  it('mengembalikan path nyata untuk berkas galeri yang ada, dan null bila tidak ada', async () => {
    fs.writeFileSync(path.join(gallery, 'g1-1-0123456789abcdef.webp'), 'x');
    const resolved = await resolveGalleryFile('/uploads/gallery/g1-1-0123456789abcdef.webp', cwd);
    expect(resolved && fs.readFileSync(resolved, 'utf8')).toBe('x');
    expect(await resolveGalleryFile('/uploads/gallery/g1-2-0123456789abcdef.webp', cwd)).toBeNull();
    expect(await resolveGalleryFile('/uploads/gallery/../../.env', cwd)).toBeNull();
    expect(await resolveGalleryFile(null, cwd)).toBeNull();
  });

  it('symlink di folder galeri yang menunjuk ke luar folder ditolak', async () => {
    const outside = path.join(cwd, 'rahasia.mp4');
    fs.writeFileSync(outside, 'rahasia');
    try {
      fs.symlinkSync(outside, path.join(gallery, 'g1-3-0123456789abcdef.mp4'));
    } catch {
      return; // Windows tanpa izin symlink: kasus ini diperiksa di Linux/CI.
    }
    expect(await resolveGalleryFile('/uploads/gallery/g1-3-0123456789abcdef.mp4', cwd)).toBeNull();
  });
});
