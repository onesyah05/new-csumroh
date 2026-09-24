import { businessDateKey, dateOnlyKey, isLostStatus, isWonStatus, lostStatuses, PIC_TAKEOVER_AFTER_MINUTES } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { getLivechatConversationsForBrand } from '../chat/chat.routes.js';

/**
 * "Perlu dikerjakan sekarang" di Ringkasan, berbeda per role. Hitungan SLA memakai daftar percakapan yang
 * sama dengan Inbox (duplikat nomor digabung, `awaitingSince`), sehingga cocok dengan tombol Ambil alih dan
 * notifikasi SLA.
 */
export type TaskTone = 'urgent' | 'action' | 'clear';
export type DashboardTask = { key: string; label: string; count: number; hint: string | null; link: string; tone: TaskTone };
export type WaitingItem = { id: number; brandId: number; brandName: string | null; name: string; waitedMinutes: number; picName: string | null; link: string };
export type DashboardTasks = { role: string; tasks: DashboardTask[]; waiting: { title: string; items: WaitingItem[] } | null };

const REPLY_WARNING_MINUTES = 10;
const ESCALATION_MINUTES = 30;
const UNASSIGNED_MINUTES = 30;
const PROOF_STALE_HOURS = 2;
const PROOF_ESCALATION_HOURS = 24;
const HOUR = 3_600_000;

type Conversation = Awaited<ReturnType<typeof getLivechatConversationsForBrand>>[number];
type Actor = { id: number; role: string };

const task = (key: string, label: string, count: number, link: string, options: { urgent?: boolean; hint?: string | null } = {}): DashboardTask => ({
  key, label, count, link, hint: options.hint ?? null, tone: count === 0 ? 'clear' : options.urgent ? 'urgent' : 'action',
});
const inboxLink = (c: { id: number; brandId: number }) => `/inbox?prospectId=${c.id}&brandId=${c.brandId}`;
const waitedMinutes = (c: Conversation, now: Date) => (c.awaitingSince ? Math.floor((now.getTime() / 1000 - c.awaitingSince) / 60) : 0);

async function conversationsFor(brandIds: number[]) {
  const lists = await Promise.all(brandIds.map((id) => getLivechatConversationsForBrand(id, { requireConnected: false })));
  return lists.flat().filter((c) => !c.isGroup && !c.isOwn && c.remoteJid !== '0@s.whatsapp.net' && !isWonStatus(c.status) && !isLostStatus(c.status));
}

function waitingList(items: Conversation[], now: Date, title: string, brandNames: Map<number, string>) {
  const rows = items
    .filter((c) => c.awaitingSince)
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
    where: { brandId: { in: brandIds }, paymentProofUrl: { not: null }, status: { notIn: [...lostStatuses] } },
    select: { id: true, brandId: true, name: true, paymentProofUrl: true, paymentProofSubmittedAt: true, payments: { select: { proofUrl: true } } },
  });
  // Sama dengan antrean Finance: bukti yang sudah dipakai pembayaran terverifikasi tidak lagi menunggu.
  return rows.filter((p) => !p.payments.some((pay) => pay.proofUrl === p.paymentProofUrl));
}

export async function tasksForCs(user: Actor, brandIds: number[], now = new Date()): Promise<DashboardTasks> {
  const conversations = await conversationsFor(brandIds);
  const today = businessDateKey(now);
  const mine = conversations.filter((c) => c.userId === user.id);
  const myWaiting = mine.filter((c) => c.awaitingSince);
  const longest = Math.max(0, ...myWaiting.map((c) => waitedMinutes(c, now)));
  const takeover = conversations.filter((c) => c.userId && c.userId !== user.id && waitedMinutes(c, now) >= PIC_TAKEOVER_AFTER_MINUTES);
  const unassigned = conversations.filter((c) => !c.userId);
  const followToday = mine.filter((c) => dateOnlyKey(c.nextFollowupDate) === today).length;
  const followLate = mine.filter((c) => { const d = dateOnlyKey(c.nextFollowupDate); return d !== null && d < today; }).length;
  const invoiceLate = mine.filter((c) => c.status === 'closing' && c.invoiceDueAt && new Date(c.invoiceDueAt) < now).length;

  return {
    role: 'cs',
    tasks: [
      task('reply', 'Jamaah menunggu balasan', myWaiting.length, '/pipeline?quick=reply&pic=mine', {
        urgent: longest >= REPLY_WARNING_MINUTES,
        hint: myWaiting.length ? `Terlama ${longest} menit${longest >= PIC_TAKEOVER_AFTER_MINUTES ? ' · bisa diambil alih CS lain' : ''}` : null,
      }),
      task('followup_today', 'Follow-up hari ini', followToday, '/pipeline?quick=today&pic=mine'),
      task('followup_late', 'Follow-up terlambat', followLate, '/pipeline?quick=overdue&pic=mine', { urgent: true }),
      task('invoice_late', 'Invoice lewat jatuh tempo', invoiceLate, '/pipeline?pic=mine', { hint: invoiceLate ? 'Ingatkan jamaah atau perbarui jatuh tempo' : null }),
      task('takeover', 'Bisa diambil alih', takeover.length, '/pipeline?quick=reply', { hint: takeover.length ? `Jamaah CS lain belum dibalas ${PIC_TAKEOVER_AFTER_MINUTES}+ menit` : null }),
      task('unassigned', 'Lead tanpa PIC', unassigned.length, '/pipeline?pic=none', { hint: unassigned.length ? 'Klaim untuk menjadi PIC' : null }),
    ],
    waiting: waitingList(myWaiting, now, 'Jamaah saya yang menunggu balasan', new Map()),
  };
}

export async function tasksForFinance(brandIds: number[], now = new Date()): Promise<DashboardTasks> {
  const [proofs, refunds, overpaid, invoices, brands] = await Promise.all([
    pendingProofs(brandIds),
    prisma.prospect.findMany({ where: { brandId: { in: brandIds }, status: { in: [...lostStatuses] }, dpAmount: { gt: 0 } }, select: { dpAmount: true } }),
    prisma.prospect.findMany({ where: { brandId: { in: brandIds }, status: { in: ['deal', 'closed_won'] }, dealValue: { gt: 0 } }, select: { dpAmount: true, dealValue: true } }),
    prisma.prospect.count({ where: { brandId: { in: brandIds }, status: 'closing', invoiceDueAt: { lt: now } } }),
    prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true } }),
  ]);
  const hoursWaiting = (p: { paymentProofSubmittedAt: Date | null }) =>
    p.paymentProofSubmittedAt ? Math.floor((now.getTime() - p.paymentProofSubmittedAt.getTime()) / HOUR) : 0;
  const stale = proofs.filter((p) => hoursWaiting(p) >= PROOF_STALE_HOURS);
  const oldest = Math.max(0, ...proofs.map(hoursWaiting));
  const refundCash = refunds.reduce((sum, r) => sum + (Number(r.dpAmount) || 0), 0);
  const overpaidCount = overpaid.filter((p) => Number(p.dpAmount) > Number(p.dealValue)).length;
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
      }),
      task('refund', 'Perlu refund', refunds.length, '/pipeline?quick=lost', {
        urgent: true, hint: refunds.length ? `Dana terverifikasi Rp ${refundCash.toLocaleString('id-ID')} pada booking batal` : null,
      }),
      task('overpaid', 'Kelebihan bayar', overpaidCount, '/pipeline?quick=won'),
      task('invoice_late', 'Invoice lewat jatuh tempo', invoices, '/verifikasi', { hint: invoices ? 'Pantau bukti yang masuk dari jamaah' : null }),
    ],
    waiting: waiting.length ? { title: 'Bukti transfer terlama', items: waiting } : null,
  };
}

export async function tasksForManager(brandIds: number[], now = new Date()): Promise<DashboardTasks> {
  const [conversations, proofs, sessions, brands] = await Promise.all([
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
  ]);
  const waiting15 = conversations.filter((c) => c.userId && waitedMinutes(c, now) >= PIC_TAKEOVER_AFTER_MINUTES);
  const waiting30 = waiting15.filter((c) => waitedMinutes(c, now) >= ESCALATION_MINUTES);
  const unassigned = conversations.filter((c) => !c.userId);
  const unassignedOld = unassigned.filter((c) => now.getTime() - new Date(c.createdAt).getTime() >= UNASSIGNED_MINUTES * 60_000);
  const connected = new Set(sessions.filter((s) => s.status === 'connected').map((s) => s.brandId));
  const disconnected = brandIds.filter((id) => !connected.has(id));
  const staleProofs = proofs.filter((p) => p.paymentProofSubmittedAt && now.getTime() - p.paymentProofSubmittedAt.getTime() >= PROOF_ESCALATION_HOURS * HOUR);
  const noCs = brands.filter((b) => b._count.users === 0 && b.userBrands.length === 0);
  const names = new Map(brands.map((b) => [b.id, b.name]));

  return {
    role: 'manager',
    tasks: [
      task('reply_sla', `Jamaah belum dibalas ${PIC_TAKEOVER_AFTER_MINUTES}+ menit`, waiting15.length, '/pipeline?quick=reply', {
        urgent: waiting30.length > 0, hint: waiting15.length ? `${waiting30.length} lebih dari ${ESCALATION_MINUTES} menit` : null,
      }),
      task('unassigned', 'Lead tanpa PIC', unassigned.length, '/pipeline?pic=none', {
        urgent: unassignedOld.length > 0, hint: unassignedOld.length ? `${unassignedOld.length} menunggu lebih dari ${UNASSIGNED_MINUTES} menit` : null,
      }),
      task('wa_disconnected', 'Perangkat WhatsApp terputus', disconnected.length, '/devices', {
        urgent: true, hint: disconnected.length ? disconnected.map((id) => names.get(id) ?? `Brand ${id}`).join(', ') : null,
      }),
      task('proofs', 'Bukti transfer menunggu', proofs.length, '/verifikasi', {
        urgent: staleProofs.length > 0, hint: proofs.length ? `${staleProofs.length} lebih dari 1 hari` : null,
      }),
      task('no_cs', 'Brand tanpa CS aktif', noCs.length, '/staff', { urgent: true, hint: noCs.length ? noCs.map((b) => b.name).join(', ') : null }),
    ],
    waiting: waitingList(waiting15, now, 'Menunggu balasan terlama', names),
  };
}
