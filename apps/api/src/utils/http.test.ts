import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from './http.js';

function statusFor(error: unknown) {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  errorHandler(error, {} as never, res as never, () => undefined);
  return res.status.mock.calls[0]![0];
}

describe('Error database tidak tersedia', () => {
  it('dijawab 503 agar gateway menahan event, bukan membuangnya', () => {
    expect(statusFor(Object.assign(new Error('Can\'t reach database server'), { code: 'P1001' }))).toBe(503);
    expect(statusFor(Object.assign(new Error('Server has closed the connection'), { code: 'P1017' }))).toBe(503);
    expect(statusFor(Object.assign(new Error('Timed out fetching a new connection'), { code: 'P2024' }))).toBe(503);
    expect(statusFor(Object.assign(new Error('init'), { name: 'PrismaClientInitializationError' }))).toBe(503);
  });

  it('error lain tetap 500', () => {
    expect(statusFor(new Error('bug'))).toBe(500);
    expect(statusFor(Object.assign(new Error('not found'), { code: 'P2025' }))).toBe(500);
  });
});
