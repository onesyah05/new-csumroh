import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * Lead Harian: berapa nomor yang ditangani tiap CS per hari bisnis (WIB).
 * - Ditangani = CS mengirim minimal satu pesan ke nomor itu pada hari tersebut. Dihitung per nomor, bukan per pesan.
 * - Lead baru = nomor yang belum pernah dibalas siapa pun sebelum hari itu. Lead lama = sudah pernah dibalas
 *   (termasuk balasan dari HP) sebelum hari itu.
 * - Rentang beberapa hari = jumlah hitungan per hari; nomor lama yang dichat tiga hari dihitung tiga kali.
 * - Pengirim = akun CRM (sender_user_id). Pesan lama sebelum kolom itu ada dicocokkan lewat nama CS. Selain itu
 *   (diketik langsung di HP WhatsApp brand) masuk baris "Dari HP".
 * - Waktu balas = median menit dari pesan jamaah pertama sampai balasan pertama, untuk lead baru, milik pengirim balasan itu.
 * Chat spam tidak dihitung.
 */

const WIB_OFFSET_SECONDS = 7 * 3600;
const DAY_SECONDS = 86_400;
const dayOf = (timestamp: number) => Math.floor((timestamp + WIB_OFFSET_SECONDS) / DAY_SECONDS);

export const PHONE_KEY = 'hp';

export type LeadHandlingUser = { id: number; name: string; isActive: boolean };
export type LeadHandlingRow = {
  key: string;
  userId: number | null;
  name: string;
  isActive: boolean;
  newLeads: number;
  oldLeads: number;
  medianReplyMinutes: number | null;
};

type OutboundRow = { day: number | bigint; prospect_id: number; sender_user_id: number | null; sender_name: string | null };
type FirstOutRow = { prospect_id: number; first_out: number | bigint };
type FirstInRow = { prospect_id: number; first_in: number | bigint };

const median = (values: number[]) => {
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

/**
 * @param brandIds brand dalam cakupan; null = semua brand.
 * @param users CS yang selalu tampil (meski nol). Pengirim lain yang tercatat (mis. admin) ikut tampil bila punya aktivitas.
 * @param range batas waktu periode (awal hari pertama sampai akhir hari terakhir, WIB).
 */
export async function leadHandling(brandIds: number[] | null, users: LeadHandlingUser[], range: { gte: Date; lte: Date }): Promise<LeadHandlingRow[]> {
  const fromTs = Math.floor(range.gte.getTime() / 1000);
  const toTs = Math.floor(range.lte.getTime() / 1000);
  const brandSql = brandIds ? Prisma.sql`AND m.brand_id IN (${Prisma.join(brandIds.length ? brandIds : [0])})` : Prisma.empty;

  // Satu baris per hari × nomor × pengirim: cukup untuk menghitung per nomor tanpa memuat setiap pesan.
  const outbound = await prisma.$queryRaw<OutboundRow[]>`
    SELECT FLOOR((m.timestamp + ${WIB_OFFSET_SECONDS}) / ${DAY_SECONDS}) AS day, m.prospect_id, m.sender_user_id, m.sender_name
    FROM chat_messages m
    JOIN prospects p ON p.id = m.prospect_id AND p.spam_at IS NULL
    WHERE m.is_from_me = 1 AND m.timestamp >= ${fromTs} AND m.timestamp <= ${toTs} ${brandSql}
    GROUP BY day, m.prospect_id, m.sender_user_id, m.sender_name`;

  const prospectIds = [...new Set(outbound.map((r) => Number(r.prospect_id)))];
  const firstOutDay = new Map<number, number>();
  const firstOutTs = new Map<number, number>();
  for (const ids of chunks(prospectIds)) {
    const rows = await prisma.$queryRaw<FirstOutRow[]>`
      SELECT prospect_id, MIN(timestamp) AS first_out FROM chat_messages
      WHERE prospect_id IN (${Prisma.join(ids)}) AND is_from_me = 1
      GROUP BY prospect_id`;
    for (const row of rows) {
      firstOutTs.set(Number(row.prospect_id), Number(row.first_out));
      firstOutDay.set(Number(row.prospect_id), dayOf(Number(row.first_out)));
    }
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
    return user ? { key: `user:${user.id}`, user } : { key: PHONE_KEY, user: null };
  };
  for (const user of users) rowFor(`user:${user.id}`, user);

  // Satu nomor dihitung sekali per hari per pengirim, walau pesannya banyak atau namanya tercatat berbeda.
  const counted = new Set<string>();
  for (const r of outbound) {
    const prospectId = Number(r.prospect_id);
    const day = Number(r.day);
    const sender = senderOf(r.sender_user_id, r.sender_name);
    const id = `${sender.key}|${day}|${prospectId}`;
    if (counted.has(id)) continue;
    counted.add(id);
    const row = rowFor(sender.key, sender.user);
    if (firstOutDay.get(prospectId) === day) row.newLeads += 1;
    else row.oldLeads += 1;
  }

  // Waktu balas lead baru: pesan jamaah pertama → balasan pertama sesudahnya, milik pengirim balasan itu.
  const newLeadIds = prospectIds.filter((id) => {
    const ts = firstOutTs.get(id);
    return ts !== undefined && ts >= fromTs && ts <= toTs;
  });
  const replies = new Map<string, number[]>();
  for (const ids of chunks(newLeadIds)) {
    const firstIn = await prisma.$queryRaw<FirstInRow[]>`
      SELECT prospect_id, MIN(timestamp) AS first_in FROM chat_messages
      WHERE prospect_id IN (${Prisma.join(ids)}) AND is_from_me = 0
      GROUP BY prospect_id`;
    const inbound = new Map(firstIn.map((row) => [Number(row.prospect_id), Number(row.first_in)]));
    const replied = await prisma.chatMessage.findMany({
      where: { prospectId: { in: ids }, isFromMe: true, timestamp: { gte: fromTs, lte: toTs } },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      select: { prospectId: true, timestamp: true, senderUserId: true, senderName: true },
    });
    const done = new Set<number>();
    for (const message of replied) {
      const prospectId = message.prospectId!;
      const firstInTs = inbound.get(prospectId);
      // Tanpa pesan jamaah sebelumnya (CS memulai chat) tidak ada waktu balas.
      if (done.has(prospectId) || firstInTs === undefined || message.timestamp < firstInTs) continue;
      done.add(prospectId);
      const sender = senderOf(message.senderUserId, message.senderName);
      const list = replies.get(sender.key) ?? [];
      list.push(Math.round((message.timestamp - firstInTs) / 60));
      replies.set(sender.key, list);
    }
  }
  for (const [key, minutes] of replies) {
    const row = known.get(key);
    if (row) row.medianReplyMinutes = median(minutes);
  }

  const rows = [...known.values()].filter((r) => r.key !== PHONE_KEY && (r.isActive || r.newLeads || r.oldLeads))
    .sort((a, b) => b.newLeads + b.oldLeads - (a.newLeads + a.oldLeads) || a.name.localeCompare(b.name));
  const phone = known.get(PHONE_KEY);
  return phone ? [...rows, phone] : rows;
}
