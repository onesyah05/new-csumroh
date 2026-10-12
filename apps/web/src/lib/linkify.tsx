import type { ReactNode } from 'react';

// http(s):// atau www.; berhenti di spasi. Tanda baca penutup kalimat dilepas dari tautan.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;
// Kelas Tailwind harus utuh di sumber; garis bawah mengikuti warna teks (decoration-current).
const LINK_CLASS = 'text-[#027eb5] underline decoration-current underline-offset-2 break-all hover:opacity-80';

/** Pisahkan teks menjadi potongan teks biasa dan tautan; hanya skema http/https yang dibuat bisa diklik. */
export function splitLinks(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const url = raw.replace(TRAILING, '');
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function linkifyText(text: string): ReactNode[] {
  return splitLinks(text).map((part, index) =>
    part.href ? (
      <a
        key={index}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className={LINK_CLASS}
      >
        {part.text}
      </a>
    ) : (
      part.text
    ),
  );
}
