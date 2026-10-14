import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Setiap panggilan API → WhatsApp gateway wajib punya batas waktu: tanpa itu gateway/WhatsApp yang menggantung
 * menahan request CS sampai ±5 menit (batas bawaan undici) dan mendorong kirim ulang ganda.
 */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('Panggilan ke gateway WhatsApp', () => {
  it('semuanya memakai AbortSignal.timeout', () => {
    const root = path.resolve(__dirname, '..');
    const missing: string[] = [];
    let found = 0;
    for (const file of sourceFiles(root)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes('fetch(`${env.WA_GATEWAY_URL}')) return;
        found += 1;
        const window = lines.slice(index, index + 12).join('\n');
        if (!window.includes('AbortSignal.timeout')) missing.push(`${path.relative(root, file)}:${index + 1}`);
      });
    }
    expect(found).toBeGreaterThanOrEqual(8);
    expect(missing).toEqual([]);
  });
});
