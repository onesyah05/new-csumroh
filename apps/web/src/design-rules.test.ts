import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga aturan desain (AGENTS-csumroh.md §3) agar audit G9–G11 tidak mundur:
 * - warna hanya monokrom + semantik (emerald sukses/Deal, rose error/mendesak, amber peringatan);
 * - teks minimal 12 px (11 px hanya angka di lencana hitungan);
 * - tanpa `<select>` native dan `window.confirm`.
 * Inbox dan panel di dalamnya sengaja bergaya WhatsApp Web (keputusan user 24/09/2026).
 */
const SRC = join(__dirname);
const EXEMPT = new Set([
  'features/chat/InboxPage.tsx',
  'features/chat/ChatProspectProfile.tsx',
  'features/chat/ChatCopilotPanel.tsx',
  'features/chat/EmojiPicker.tsx',
  'features/chat/ChatSidePanel.tsx',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC)
  .map((path) => ({ rel: relative(SRC, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }))
  .filter((file) => !EXEMPT.has(file.rel));

function violations(pattern: RegExp, allowLine?: (line: string) => boolean) {
  const found: string[] = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      if (pattern.test(line) && !allowLine?.(line)) found.push(`${file.rel}:${index + 1}`);
    });
  }
  return found;
}

describe('Aturan desain', () => {
  it('memindai seluruh berkas UI (bukan lulus karena kosong)', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.rel === 'features/prospects/PipelinePage.tsx')).toBe(true);
  });

  it('warna hanya monokrom dan semantik', () => {
    expect(violations(/\b(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow)-(?:blue|sky|indigo|violet|purple|teal|cyan|pink|lime|fuchsia|green|red|yellow|orange)-\d{2,3}\b/)).toEqual([]);
    expect(violations(/\[#[0-9a-fA-F]{3,8}\]/)).toEqual([]);
  });

  it('teks minimal 12 px; 11 px hanya angka di lencana hitungan', () => {
    expect(violations(/text-\[(?:[0-9]|10)px\]/)).toEqual([]);
    expect(violations(/text-\[11px\]/, (line) => line.includes('tabular-nums') || line.includes('min-w-[18px]'))).toEqual([]);
  });

  it('tabel nyaman di split-screen ±700 px: lebar minimum besar hanya mulai lg', () => {
    const wide = violations(/<table[^>]*(?<![a-z]:)min-w-\[(?:[7-9]\d\d|\d{4,})px\]/);
    expect(wide).toEqual([]);
  });

  it('tanpa <select> native dan window.confirm', () => {
    expect(violations(/<select[\s>]/)).toEqual([]);
    expect(violations(/(?:window\.|[^.\w])confirm\(/)).toEqual([]);
  });
});
