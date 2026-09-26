import { businessDateKey, dateOnlyKey, isLostStatus, isWonStatus, lostStatuses, PIC_TAKEOVER_AFTER_MINUTES, wonStatuses } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { getLivechatConversationsForBrand } from '../chat/chat.routes.js';

/**
 * "Perlu dikerjakan sekarang" di Ringkasan, berbeda per role. Hitungan SLA memakai daftar percakapan yang
 * sama dengan Inbox (duplikat nomor digabung, `awaitingSince`), sehingga cocok dengan tombol Ambil alih dan
 * notifikasi SLA.
 */
export type TaskTone = 'urgent' | 'action' | 'clear';
/** `action` = kata kerja tombol (mis. "Balas", "Verifikasi") agar setiap baris jelas langkah berikutnya. */
export type DashboardTask = { key: string; label: string; count: number; hint: string | null; link: string; action: string; tone: TaskTone };
export type WaitingItem = { id: number; brandId: number; brandName: string | null; name: string; waitedMinutes: number; picName: string | null; link: string };
export type DashboardTasks = { role: string; tasks: DashboardTask[]; waiting: { title: string; items: WaitingItem[] } | null };

const REPLY_WARNING_MINUTES = 10;
const ESCALATION_MINUTES = 30;
const UNASSIGNED_MINUTES = 30;
const PROOF_STALE_HOURS = 2;
const PROOF_ESCALATION_HOURS = 24;
/**
 * Episode menunggu yang lebih lama dari ini bukan lagi "belum dibalas" yang mendesak, melainkan percakapan
 * terbengkalai (perlu dibersihkan: balas, tandai Batal, atau lepas PIC). Tanpa batas ini kartu mendesak
 * akan merah permanen oleh chat lama dan diabaikan.
 */
export const ACTIVE_WAIT_HOURS = 24;
const HOUR = 3_600_000;
const CLOSED = [...wonStatuses, ...lostStatuses];

type Conversation = Awaited<ReturnType<typeof getLivechatConversationsForBrand>>[number];
type Actor = { id: number; role: string };

const task = (key: string, label: string, count: number, link: string, options: { urgent?: boolean; hint?: string | null; action?: string } = {}): DashboardTask => ({
  key, label, count, link, hint: options.hint ?? null, action: options.action ?? 'Buka', tone: count === 0 ? 'clear' : options.urgent ? 'urgent' : 'action',
});
const inboxLink = (c: { id: number; brandId: number }) => `/inbox?prospectId=${c.id}&brandId=${c.brandId}`;
const waitedMinutes = (c: Conversation, now: Date) => (c.awaitingSince ? Math.floor((now.getTime() / 1000 - c.awaitingSince) / 60) : 0);
const isActiveWait = (c: Conversation, now: Date) => Boolean(c.awaitingSince) && waitedMinutes(c, now) <= ACTIVE_WAIT_HOURS * 60;
const isStaleWait = (c: Conversation, now: Date) => Boolean(c.awaitingSince) && waitedMinutes(c, now) > ACTIVE_WAIT_HOURS * 60;
const STALE_HINT = `Belum dibalas lebih dari ${ACTIVE_WAIT_HOURS} jam: balas, tandai Batal, atau lepas PIC`;

async function conversationsFor(brandIds: number[]) {
  const lists = await Promise.all(brandIds.map((id) => getLivechatConversationsForBrand(id, { requireConnected: false })));
  return lists.flat().filter((c) => !c.isGroup && !c.isOwn && c.remoteJid !== '0@s.whatsapp.net' && !c.spamAt && !isWonStatus(c.status) && !isLostStatus(c.status));
}

function waitingList(items: Conversation[], now: Date, title: string, brandNames: Map<number, string>) {
  const rows = items
    .filter((c) => isActiveWait(c, now))
    .sort((a, b) => a.awaitingSince! - b.awaitingSince!)
    .slice(0, 5)
    .map((c) => ({
      id: c.id, brandId: c.brandId, brandName: brandNames.get(c.brandId) ?? null, name: c.name,
      waitedMinutes: waitedMinutes(c, now), picName: c.user?.name ?? null, link: inboxLink(c),
    }));
  return rows.length ? { title, items: rows } : null;
}

async function pendingProofs(brandIds: number[]) {
  const rows = await prisma.prospect.findMany({
    where: { brandId: { in: brandIds }, paymentProofUrl: { not: null }, status: { notIn: CLOSED } },
    select: { id: true, brandId: true, name: true, paymentProofUrl: true, paymentProofSubmittedAt: true, payments: { select: { proofUrl: true } } },
  });
  // Sama dengan antrean Finance: bukti yang sudah dipakai pembayaran terverifikasi tidak lagi menunggu.
  return rows.filter((p) => !p.payments.some((pay) => pay.proofUrl === p.paymentProofUrl));
}

/** Data nilai deal yang perlu dilengkapi oleh Admin. */
function dealsWithoutValue(brandIds: number[]) {
  return prisma.prospect.count({ where: { brandId: { in: brandIds }, status: { in: [...wonStatuses] }, dealValue: { lte: 0 } } });
}

export async function tasksForCs(user: Actor, brandIds: number[], now = new Date()): Promise<DashboardTasks> {
  const conversations = await conversationsFor(brandIds);
  const today = businessDateKey(now);
  const mine = conversations.filter((c) => c.userId === user.id);
  const myWaiting = mine.filter((c) => isActiveWait(c, now));
  const myStale = mine.filter((c) => isStaleWait(c, now));
  const longest = Math.max(0, ...myWaiting.map((c) => waitedMinutes(c, now)));
  const takeover = conversations.filter((c) => c.userId && c.userId !== user.id && isActiveWait(c, now) && waitedMinutes(c, now) >= PIC_TAKEOVER_AFTER_MINUTES);
  const unassigned = conversations.filter((c) => !c.userId);
  const followToday = mine.filter((c) => dateOnlyKey(c.nextFollowupDate) === today).length;
  const followLate = mine.filter((c) => { const d = dateOnlyKey(c.nextFollowupDate); return d !== null && d < today; }).length;
  const invoiceLate = mine.filter((c) => c.status === 'closing' && c.invoiceDueAt && new Date(c.invoiceDueAt) < now).length;

  return {
    role: 'cs',
    tasks: [
      task('reply', 'Menunggu balasan', myWaiting.length, '/pipeline?quick=reply&pic=mine', {
        urgent: longest >= REPLY_WARNING_MINUTES,
        hint: myWaiting.length ? `Terlama ${longest} menit${longest >= PIC_TAKEOVER_AFTER_MINUTES ? ' · bisa diambil alih CS lain' : ''}` : null,
        action: 'Balas',
      }),
      task('followup_today', 'Follow-up hari ini', followToday, '/pipeline?quick=today&pic=mine', { action: 'Follow-up' }),
      task('followup_late', 'Follow-up terlambat', followLate, '/pipeline?quick=overdue&pic=mine', { urgent: true, action: 'Follow-up' }),
      task('invoice_late', 'Invoice lewat tempo', invoiceLate, '/pipeline?pic=mine', { hint: invoiceLate ? 'Ingatkan jamaah atau perbarui jatuh tempo' : null, action: 'Ingatkan' }),
      task('takeover', 'Bisa diambil alih', takeover.length, '/pipeline?quick=reply', { hint: takeover.length ? `Jamaah CS lain belum dibalas ${PIC_TAKEOVER_AFTER_MINUTES}+ menit` : null, action: 'Ambil alih' }),
      task('unassigned', 'Lead tanpa PIC', unassigned.length, '/pipeline?pic=none', { hint: unassigned.length ? 'Klaim untuk menjadi PIC' : null, action: 'Klaim' }),
      task('stale', 'Percakapan terbengkalai', myStale.length, '/pipeline?quick=reply&pic=mine', { hint: myStale.length ? STALE_HINT : null, action: 'Rapikan' }),
    ],
    waiting: waitingList(mine, now, 'Jamaah saya yang menunggu balasan', new Map()),
  };
}

export async function tasksForFinance(brandIds: number[], now = new Date()): Promise<DashboardTasks> {
  const [proofs, brands] = await Promise.all([
    pendingProofs(brandIds),
    prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true } }),
  ]);
  const hoursWaiting = (p: { paymentProofSubmittedAt: Date | null }) =>
    p.paymentProofSubmittedAt ? Math.floor((now.getTime() - p.paymentProofSubmittedAt.getTime()) / HOUR) : 0;
  const stale = proofs.filter((p) => hoursWaiting(p) >= PROOF_STALE_HOURS);
  const oldest = Math.max(0, ...proofs.map(hoursWaiting));
  const names = new Map(brands.map((b) => [b.id, b.name]));

  const waiting = proofs
    .filter((p) => p.paymentProofSubmittedAt)
    .sort((a, b) => a.paymentProofSubmittedAt!.getTime() - b.paymentProofSubmittedAt!.getTime())
    .slice(0, 5)
    .map((p) => ({
      id: p.id, brandId: p.brandId, brandName: names.get(p.brandId) ?? null, name: p.name,
      waitedMinutes: Math.floor((now.getTime() - p.paymentProofSubmittedAt!.getTime()) / 60_000), picName: null, link: '/verifikasi',
    }));

  return {
    role: 'finance',
    tasks: [
      task('proofs', 'Bukti transfer menunggu', proofs.length, '/verifikasi', {
        urgent: stale.length > 0,
        hint: proofs.length ? `${stale.length} lebih dari ${PROOF_STALE_HOURS} jam · terlama ${oldest} jam` : null,
        action: 'Verifikasi',
      }),
    ],
    waiting: waiting.length ? { title: 'Bukti transfer terlama', items: waiting } : null,
  };
}

export async function tasksForManager(brandIds: number[], now = new Date()): Promise<DashboardTasks> {
  const [conversations, proofs, sessions, brands, incomplete, invalidPic] = await Promise.all([
    conversationsFor(brandIds),
    pendingProofs(brandIds),
    prisma.whatsappSession.findMany({ where: { brandId: { in: brandIds } }, select: { brandId: true, status: true } }),
    prisma.brand.findMany({
      where: { id: { in: brandIds } },
      select: {
        id: true, name: true,
        _count: { select: { users: { where: { role: 'cs', isActive: true } } } },
        userBrands: { where: { user: { role: 'cs', isActive: true } }, select: { userId: true } },
      },
    }),
    dealsWithoutValue(brandIds),
    // Data lama: PIC yang bukan CS aktif (mis. Super Admin, CS nonaktif) — tidak bisa dikerjakan sesuai aturan PIC.
    prisma.prospect.count({
      where: {
        brandId: { in: brandIds }, userId: { not: null }, status: { notIn: CLOSED },
        user: { is: { OR: [{ role: { not: 'cs' } }, { isActive: false }] } },
      },
    }),
  ]);
  const names = new Map(brands.map((b) => [b.id, b.name]));
  const noCs = new Set(brands.filter((b) => b._count.users === 0 && b.userBrands.length === 0).map((b) => b.id));

  const waiting15 = conversations.filter((c) => c.userId && isActiveWait(c, now) && waitedMinutes(c, now) >= PIC_TAKEOVER_AFTER_MINUTES);
  const waiting30 = waiting15.filter((c) => waitedMinutes(c, now) >= ESCALATION_MINUTES);
  const stale = conversations.filter((c) => isStaleWait(c, now));
  const unassigned = conversations.filter((c) => !c.userId);
  const unassignedOld = unassigned.filter((c) => now.getTime() - new Date(c.createdAt).getTime() >= UNASSIGNED_MINUTES * 60_000);
  const connected = new Set(sessions.filter((s) => s.status === 'connected').map((s) => s.brandId));
  const disconnected = brandIds.filter((id) => !connected.has(id));
  const staleProofs = proofs.filter((p) => p.paymentProofSubmittedAt && now.getTime() - p.paymentProofSubmittedAt.getTime() >= PROOF_ESCALATION_HOURS * HOUR);

  // Lead tanpa PIC dipisah menurut penyebab (satu masalah = satu baris): di brand tanpa CS aktif jalan
  // keluarnya menambah CS (Staf); di brand lain lead perlu dibagikan (Pipeline brand dengan antrean terbanyak).
  const blocked = unassigned.filter((c) => noCs.has(c.brandId));
  const assignable = unassigned.filter((c) => !noCs.has(c.brandId));
  const assignableOld = assignable.filter((c) => unassignedOld.includes(c));
  const byBrand = new Map<number, number>();
  for (const c of assignable) byBrand.set(c.brandId, (byBrand.get(c.brandId) ?? 0) + 1);
  const topBrand = [...byBrand].sort((a, b) => b[1] - a[1])[0]?.[0];
  const noCsNames = [...noCs].map((id) => names.get(id) ?? `Brand ${id}`).join(', ');

  return {
    role: 'manager',
    tasks: [
      task('reply_sla', 'Chat belum dibalas lebih dari 15 menit', waiting15.length, '/pipeline?quick=reply', {
        urgent: waiting30.length > 0, hint: waiting15.length ? `${waiting30.length} di antaranya lebih dari ${ESCALATION_MINUTES} menit` : null, action: 'Lihat',
      }),
      // Hitungan = lead yang tertahan (minimal 1 agar brand tanpa CS tetap tampil walau belum ada lead).
      task('no_cs', 'Lead tertahan: brand belum punya CS aktif', noCs.size ? Math.max(blocked.length, 1) : 0, '/staff', {
        urgent: blocked.length > 0, hint: noCs.size ? `${noCsNames}. Tambahkan CS agar lead bisa dibalas dan dibagikan` : null, action: 'Tambah CS',
      }),
      task('unassigned', 'Lead belum punya PIC', assignable.length, topBrand ? `/pipeline?pic=none&brandId=${topBrand}` : '/pipeline?pic=none', {
        urgent: assignableOld.length > 0,
        hint: assignableOld.length ? `${assignableOld.length} menunggu lebih dari ${UNASSIGNED_MINUTES} menit` : null,
        action: 'Bagikan',
      }),
      task('wa_disconnected', 'WhatsApp brand terputus', disconnected.length, '/brands', {
        urgent: true, hint: disconnected.length ? `${disconnected.map((id) => names.get(id) ?? `Brand ${id}`).join(', ')}: chat jamaah tidak masuk` : null, action: 'Hubungkan',
      }),
      task('proofs', 'Bukti transfer menunggu verifikasi', proofs.length, '/verifikasi', {
        urgent: staleProofs.length > 0, hint: staleProofs.length ? `${staleProofs.length} lebih dari 1 hari` : null, action: 'Verifikasi',
      }),
      task('stale', 'Percakapan terbengkalai', stale.length, '/pipeline?quick=reply', { hint: stale.length ? STALE_HINT : null, action: 'Rapikan' }),
      task('invalid_pic', 'Prospek dengan PIC bukan CS aktif', invalidPic, '/pipeline', {
        hint: invalidPic ? 'Tugaskan ulang ke CS atau lepas ke antrean' : null, action: 'Tugaskan',
      }),
      task('deal_incomplete', 'Nilai deal belum lengkap', incomplete, '/pipeline?view=table&lingkup=deal', {
        hint: incomplete ? 'Lengkapi nilai deal untuk laporan penjualan' : null, action: 'Lengkapi',
      }),
    ],
    waiting: waitingList(waiting15, now, 'Menunggu balasan terlama', names),
  };
}
