import { timingSafeEqual } from 'node:crypto';

/** Perbandingan secret yang tidak membocorkan panjang prefix yang cocok lewat waktu respons. */
export function secretMatches(candidate: string | undefined | null, expected: string) {
  const a = Buffer.from(candidate ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
