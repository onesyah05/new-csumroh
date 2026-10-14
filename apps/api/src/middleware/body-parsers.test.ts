import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { bodyParsers } from './body-parsers.js';

function request(path: string, headers: Record<string, string>, body = '') {
  const stream: any = Readable.from(body ? [Buffer.from(body)] : []);
  stream.path = path;
  stream.url = path;
  stream.method = 'POST';
  stream.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...headers };
  stream.get = (name: string) => stream.headers[name.toLowerCase()];
  return stream;
}

describe('Parser body: rute internal diperiksa secret sebelum JSON diparse', () => {
  it('tanpa atau dengan secret salah: ditolak 401 dan body tidak dibaca', () => {
    for (const headers of [{}, { 'x-internal-secret': 'salah' }]) {
      const req = request('/internal/messages', headers, JSON.stringify({ brandId: 1 }));
      const next = vi.fn();
      bodyParsers(req, {} as any, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]![0]).toMatchObject({ status: 401 });
      expect(req.body).toBeUndefined();
      expect(req.readableFlowing).toBeNull();
    }
  });

  it('dengan secret yang benar: body diparse', async () => {
    const req = request('/internal/messages', { 'x-internal-secret': env.WA_GATEWAY_SECRET }, JSON.stringify({ brandId: 1 }));
    await new Promise<void>((resolve, reject) => bodyParsers(req, {} as any, (error?: unknown) => (error ? reject(error) : resolve())));
    expect(req.body).toEqual({ brandId: 1 });
  });

  it('rute unggah besar tanpa token ditolak sebelum body diparse', () => {
    const req = request('/api/v1/gallery/assets', {}, JSON.stringify({ data: 'x' }));
    const next = vi.fn();
    bodyParsers(req, {} as any, next);
    expect(next.mock.calls[0]![0]).toMatchObject({ status: 401 });
    expect(req.body).toBeUndefined();
  });
});
