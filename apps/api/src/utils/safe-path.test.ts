import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLYER_URL_PATTERN, isPathInside } from './safe-path.js';

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
