import { Prisma } from '@prisma/client';
import { compareLeadRows, LEAD_PHONE_KEY, type LeadHandlingReport, type LeadHandlingRow } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';

/**
 * Lead Harian: berapa nomor yang ditangani tiap CS per hari bisnis (WIB).
 * - Ditangani = CS mengirim minimal satu pesan ke nomor itu pada hari tersebut. Dihitung per nomor, bukan per pesan.
 * - Lead baru = nomor yang belum pernah dibalas siapa pun sebelum hari itu. Lead lama = sudah pernah dibalas
 *   (termasuk balasan dari HP) sebelum hari itu.
 * - Rentang beberapa hari = jumlah hitungan per hari; nomor lama yang dichat tiga hari dihitung tiga kali.
 * - Pengirim = akun CRM (sender_user_id). Pesan lama sebelum kolom itu ada dicocokkan lewat nama CS. Selain itu
 *   (diketik langsung di HP WhatsApp brand) masuk baris "Dari HP".
 * - Waktu balas = median waktu balas pertama (lihat firstReplies) untuk lead baru, milik pengirim balasan itu.
 * - Total = nomor berbeda per hari: nomor yang dichat dua CS pada hari yang sama dihitung sekali.
 * Chat spam tidak dihitung.
 */

const WIB_OFFSET_SECONDS = 7 * 3600;
const DAY_SECONDS = 86_400;
const dayOf = (timestamp: number) => Math.floor((timestamp + WIB_OFFSET_SECONDS) / DAY_SECONDS);

export type LeadHandlingUser = { id: number; name: string; isActive: boolean };

type OutboundRow = { day: number | bigint; prospect_id: number; sender_user_id: number | null; sender_name: string | null };
type FirstOutRow = { prospect_id: number; first_out: number | bigint };
type FirstReplyRow = { prospect_id: number; first_in: number | bigint; first_out: number | bigint; sender_user_id: number | null; sender_name: string | null };

export const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

const chunks = <T,>(items: T[], size = 2000) => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export type FirstReply = { minutes: number; senderUserId: number | null; senderName: string | null };

/**
 * Waktu balas pertama, satu definisi untuk Lead Harian dan Kinerja CS: menit kalender dari pesan jamaah pertama
 * (yang tidak dihapus) sampai pesan keluar pertama sesudahnya, beserta pengirim pesan keluar itu.
 * Nomor tanpa pesan jamaah, atau belum dibalas, tidak punya waktu balas.
 */
export async function firstReplies(prospectIds: number[]): Promise<Map<number, FirstReply>> {
  const result = new Map<number, FirstReply>();
  for (const ids of chunks(prospectIds)) {
    const rows = await prisma.$queryRaw<FirstReplyRow[]>`
      SELECT fi.prospect_id, fi.first_in, o.timestamp AS first_out, o.sender_user_id, o.sender_name
      FROM (
        SELECT prospect_id, MIN(timestamp) AS first_in FROM chat_messages
        WHERE prospect_id IN (${Prisma.join(ids)}) AND is_from_me = 0 AND is_deleted = 0
        GROUP BY prospect_id
      ) fi
      JOIN chat_messages o ON o.id = (
        SELECT o2.id FROM chat_messages o2
        WHERE o2.prospect_id = fi.prospect_id AND o2.is_from_me = 1 AND o2.timestamp >= fi.first_in
        ORDER BY o2.timestamp, o2.id LIMIT 1
      )`;
    for (const row of rows) {
      result.set(Number(row.prospect_id), {
        minutes: Math.round((Number(row.first_out) - Number(row.first_in)) / 60),
        senderUserId: row.sender_user_id === null ? null : Number(row.sender_user_id),
        senderName: row.sender_name,
      });
    }
  }
  return result;
}

/**
 * @param brandIds brand dalam cakupan; null = semua brand.
 * @param users CS yang selalu tampil (meski nol). Pengirim lain yang tercatat (mis. admin) ikut tampil bila punya aktivitas.
 * @param range batas waktu periode (awal hari pertama sampai akhir hari terakhir, WIB).
 */
export async function leadHandling(
  brandIds: number[] | null,
  users: LeadHandlingUser[],
  range: { gte: Date; lte: Date },
): Promise<Omit<LeadHandlingReport, 'brandId'>> {
  const fromTs = Math.floor(range.gte.getTime() / 1000);
  const toTs = Math.floor(range.lte.getTime() / 1000);
  // Cakupan kosong (admin tanpa brand) tidak cocok dengan brand mana pun.
  const brandSql = brandIds ? Prisma.sql`AND m.brand_id IN (${Prisma.join(brandIds.length ? brandIds : [0])})` : Prisma.empty;

  // Satu baris per hari × nomor × pengirim: cukup untuk menghitung per nomor tanpa memuat setiap pesan.
  const outbound = await prisma.$queryRaw<OutboundRow[]>`
    SELECT FLOOR((m.timestamp + ${WIB_OFFSET_SECONDS}) / ${DAY_SECONDS}) AS day, m.prospect_id, m.sender_user_id, m.sender_name
    FROM chat_messages m
    JOIN prospects p ON p.id = m.prospect_id AND p.spam_at IS NULL
    WHERE m.is_from_me = 1 AND m.timestamp >= ${fromTs} AND m.timestamp <= ${toTs} ${brandSql}
    GROUP BY day, m.prospect_id, m.sender_user_id, m.sender_name`;

  const prospectIds = [...new Set(outbound.map((r) => Number(r.prospect_id)))];
  const firstOutTs = new Map<number, number>();
  for (const ids of chunks(prospectIds)) {
    const rows = await prisma.$queryRaw<FirstOutRow[]>`
      SELECT prospect_id, MIN(timestamp) AS first_out FROM chat_messages
      WHERE prospect_id IN (${Prisma.join(ids)}) AND is_from_me = 1
      GROUP BY prospect_id`;
    for (const row of rows) firstOutTs.set(Number(row.prospect_id), Number(row.first_out));
  }

  // Pengirim: akun CRM; pesan lama tanpa akun dicocokkan lewat nama CS; sisanya dari HP.
  const known = new Map<string, LeadHandlingRow>();
  const byName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u]));
  const usersById = new Map(users.map((u) => [u.id, u]));
  const extraIds = [...new Set(outbound.map((r) => r.sender_user_id).filter((id): id is number => id !== null && !usersById.has(Number(id))))];
  if (extraIds.length) {
    const extra = await prisma.user.findMany({ where: { id: { in: extraIds.map(Number) } }, select: { id: true, name: true, isActive: true } });
    for (const u of extra) usersById.set(u.id, u);
  }
  const rowFor = (key: string, user: LeadHandlingUser | null) => {
    let row = known.get(key);
    if (!row) {
      row = { key, userId: user?.id ?? null, name: user?.name ?? 'Dari HP (tanpa nama)', isActive: user?.isActive ?? true, newLeads: 0, oldLeads: 0, medianReplyMinutes: null };
      known.set(key, row);
    }
    return row;
  };
  const senderOf = (senderUserId: number | null, senderName: string | null) => {
    const user = senderUserId !== null ? usersById.get(Number(senderUserId)) : byName.get((senderName ?? '').trim().toLowerCase());
    return user ? { key: `user:${user.id}`, user } : { key: LEAD_PHONE_KEY, user: null };
  };
  for (const user of users) rowFor(`user:${user.id}`, user);

  // Satu nomor dihitung sekali per hari per pengirim, walau pesannya banyak atau namanya tercatat berbeda.
  const counted = new Set<string>();
  const totalNew = new Set<string>();
  const totalOld = new Set<string>();
  for (const r of outbound) {
    const prospectId = Number(r.prospect_id);
    const day = Number(r.day);
    const sender = senderOf(r.sender_user_id, r.sender_name);
    const id = `${sender.key}|${day}|${prospectId}`;
    if (counted.has(id)) continue;
    counted.add(id);
    const row = rowFor(sender.key, sender.user);
    const firstOut = firstOutTs.get(prospectId);
    const isNew = firstOut !== undefined && dayOf(firstOut) === day;
    if (isNew) row.newLeads += 1;
    else row.oldLeads += 1;
    (isNew ? totalNew : totalOld).add(`${day}|${prospectId}`);
  }

  // Waktu balas lead baru (balasan pertamanya jatuh di periode ini), milik pengirim balasan itu.
  const newLeadIds = prospectIds.filter((id) => {
    const ts = firstOutTs.get(id);
    return ts !== undefined && ts >= fromTs && ts <= toTs;
  });
  const replies = new Map<string, number[]>();
  for (const reply of (await firstReplies(newLeadIds)).values()) {
    const sender = senderOf(reply.senderUserId, reply.senderName);
    replies.set(sender.key, [...(replies.get(sender.key) ?? []), reply.minutes]);
  }
  for (const [key, minutes] of replies) {
    const row = known.get(key);
    if (row) row.medianReplyMinutes = median(minutes);
  }

  const rows = [...known.values()].filter((r) => r.key !== LEAD_PHONE_KEY && (r.isActive || r.newLeads || r.oldLeads)).sort(compareLeadRows);
  const phone = known.get(LEAD_PHONE_KEY);
  return { rows: phone ? [...rows, phone] : rows, totals: { newLeads: totalNew.size, oldLeads: totalOld.size } };
}
