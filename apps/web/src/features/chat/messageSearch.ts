/** Kata kunci pencarian isi chat dikirim ke server mulai dari panjang ini (sama dengan batas di API). */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;

/** Hasil GET /chat/conversations/search: pesan cocok terbaru per prospek. */
export interface MessageSearchMatch {
  prospectId: number;
  messageId: string;
  isFromMe: boolean;
  timestamp: number;
  snippet: string;
  count: number;
}

/** Pecah teks menjadi bagian biasa dan bagian yang cocok dengan kata kunci (tanpa membedakan huruf besar/kecil). */
export function splitByTerm(text: string, term: string): Array<{ text: string; match: boolean }> {
  const needle = term.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
