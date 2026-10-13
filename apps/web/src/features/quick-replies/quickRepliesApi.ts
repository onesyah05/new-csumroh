import { useQuery } from '@tanstack/react-query';
import type { QuickReplyScope } from '@csumroh/shared-types';
import { api } from '../../lib/api';

export interface QuickReply {
  id: number;
  brandId: number;
  scope: QuickReplyScope;
  ownerId: number | null;
  title: string;
  shortcut: string | null;
  body: string;
  /** Isi dengan token terisi dari prospek yang dibuka (sama dengan body bila tanpa prospek). */
  text: string;
  /** Token yang datanya belum ada; tetap tampil sebagai {{token}} di `text`. */
  missing: string[];
}

export const QUICK_REPLIES_KEY = 'quick-replies';

/** Daftar balas cepat brand (+ milik sendiri); token diisi dari prospek bila `prospectId` diberikan. */
export function useQuickReplies(brandId: number | null, prospectId?: number | null) {
  return useQuery({
    queryKey: [QUICK_REPLIES_KEY, brandId, prospectId ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ brandId: String(brandId) });
      if (prospectId) params.set('prospectId', String(prospectId));
      return api.get<QuickReply[]>('/quick-replies?' + params);
    },
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });
}

/** Token "/query" di kolom pesan: posisi awal dan akhir (untuk diganti) beserta query-nya. */
export interface SlashToken { start: number; end: number; query: string }

/** Kunci stabil token (untuk "ditutup dengan Esc sampai berubah"). */
export const slashKey = (token: SlashToken) => token.start + ':' + token.query;

/** Token `{{x}}` yang masih tersisa di teks (data belum ada) — jangan sampai terkirim ke jamaah. */
export const unresolvedTokens = (text: string) => [...new Set([...text.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)].map((match) => match[1]!.toLowerCase()))];

/** "/" yang diketik tepat sebelum kursor (di awal pesan atau setelah spasi/baris baru); query tanpa spasi. */
export function slashQueryAt(text: string, caret: number): SlashToken | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, end: caret, query: match[2]! };
}

const MAX_RESULTS = 8;

/** Saring dan urutkan: pintasan diawali query, lalu judul diawali query, lalu yang memuat query di mana saja. */
export function matchQuickReplies(list: QuickReply[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, MAX_RESULTS);
  const rank = (item: QuickReply) => {
    const shortcut = (item.shortcut ?? '').toLowerCase();
    const title = item.title.toLowerCase();
    if (shortcut.startsWith(q)) return 0;
    if (title.startsWith(q)) return 1;
    if (shortcut.includes(q) || title.includes(q)) return 2;
    if (item.body.toLowerCase().includes(q)) return 3;
    return null;
  };
  return list
    .map((item) => ({ item, score: rank(item) }))
    .filter((entry): entry is { item: QuickReply; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.item);
}
