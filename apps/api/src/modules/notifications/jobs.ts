import { Prisma } from '@prisma/client';
import { businessDateKey, dateOnlyKey, isLostStatus, isWonStatus, lostStatuses, PIC_TAKEOVER_AFTER_MINUTES, wonStatuses } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { getLivechatConversationsForBrand } from '../chat/chat.routes.js';
import { notifyWhatsappDisconnected } from './notification.events.js';
import { notify, resolveNotifications } from './notify.service.js';
import { adminsOf, csOfBrand, financeUsers, picOf } from './recipients.js';

/**
 * Ambang waktu notifikasi terjadwal. Dihitung 24 jam (belum memakai jam operasional; lihat rencana bagian 11).
 */
export const SLA = {
  replyWarningMinutes: 10,
  takeoverMinutes: PIC_TAKEOVER_AFTER_MINUTES,
  escalationMinutes: 30,
  /** Episode menunggu lebih lama dari ini tidak diproses lagi: mencegah banjir notifikasi untuk chat lama. */
  maxEpisodeHours: 3,
  unassignedLeadMinutes: 30,
  waGraceMinutes: 2,
  proofStaleHours: 2,
  proofEscalationHours: 24,
  morningHour: 8,
  eveningHour: 17,
  retentionHour: 3,
} as const;

const CLOSED = [...wonStatuses, ...lostStatuses];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const isOpenStatus = (status: string) => !isWonStatus(status) && !isLostStatus(status);
const inboxLink = (p: { id: number; brandId: number }) => `/inbox?prospectId=${p.id}&brandId=${p.brandId}`;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Kunci sekali-jalan lintas proses (tabel dedupe): true bila kunci ini baru saja diklaim oleh pemanggil. */
export async function claimOnce(key: string) {
  try {
    await prisma.notificationDedupe.create({ data: { key: key.slice(0, 191) } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export function businessHour(now: Date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(now)) % 24;
}

// ── SLA balasan & lead tanpa PIC (per brand, dari daftar percakapan yang sama dengan Inbox) ──

type Conversation = Awaited<ReturnType<typeof getLivechatConversationsForBrand>>[number];

export async function replySlaJob(now = new Date()) {
  const brands = await prisma.brand.findMany({ select: { id: true } });
  for (const brand of brands) {
    const conversations = await getLivechatConversationsForBrand(brand.id, { requireConnected: false });
    await replySlaForBrand(brand.id, conversations, now);
  }
}

export async function replySlaForBrand(brandId: number, conversations: Conversation[], now: Date) {
  const nowSec = now.getTime() / 1000;
  const eligible = conversations.filter((c) => !c.isGroup && !c.isOwn && c.remoteJid !== '0@s.whatsapp.net' && isOpenStatus(c.status));
  let takeoverOpen = 0;

  for (const c of eligible) {
    const since = c.awaitingSince;
    if (!c.userId || !since) continue;
    const waited = Math.floor((nowSec - since) / 60);
    if (waited > SLA.maxEpisodeHours * 60) continue;
    const ref = { id: c.id, brandId };
    const picName = c.user?.name ?? 'PIC';

    if (waited >= SLA.replyWarningMinutes && waited < SLA.takeoverMinutes) {
      await notify({
        type: 'reply.sla_warning', priority: 'urgent', brandId,
        userIds: await picOf({ userId: c.userId, brandId }),
        title: `${c.name} menunggu balasan ${waited} menit`,
        body: `Balas sebelum ${SLA.takeoverMinutes} menit agar prospek tidak bisa diambil alih CS lain.`,
        link: inboxLink(ref), entity: { type: 'prospect', id: c.id },
        dedupeKey: `reply.sla_warning:p${c.id}:${since}`,
      });
    }
    if (waited >= SLA.takeoverMinutes) {
      takeoverOpen++;
      const others = (await csOfBrand(brandId)).filter((id) => id !== c.userId);
      await notify({
        type: 'reply.takeover_open', priority: 'action', brandId,
        userIds: others,
        title: `Jamaah menunggu lebih dari ${SLA.takeoverMinutes} menit: ${c.name}`,
        body: `PIC ${picName} belum membalas. Anda boleh mengambil alih.`,
        link: '/pipeline?quick=reply', entity: { type: 'brand', id: brandId },
        activeKey: `reply.takeover_open:b${brandId}`,
        dedupeKey: `reply.takeover_open:p${c.id}:${since}`,
      });
    }
    if (waited >= SLA.escalationMinutes) {
      await notify({
        type: 'reply.escalation', priority: 'urgent', brandId,
        userIds: await adminsOf(brandId),
        title: `${c.name} belum dibalas ${waited} menit`,
        body: `PIC ${picName}. Tugaskan ulang atau hubungi CS.`,
        link: inboxLink(ref), entity: { type: 'prospect', id: c.id },
        dedupeKey: `reply.escalation:p${c.id}:${since}`,
      });
    }
  }
  // Tidak ada lagi jamaah yang bisa diambil alih: ringkasan brand untuk CS selesai.
  if (takeoverOpen === 0) await resolveNotifications({ entity: { type: 'brand', id: brandId }, types: ['reply.takeover_open'] });

  // Lead yang masih tanpa PIC setelah 30 menit (event awal sudah dikirim saat lead masuk tanpa CS aktif).
  for (const c of eligible) {
    if (c.userId) continue;
    const age = now.getTime() - new Date(c.createdAt).getTime();
    if (age < SLA.unassignedLeadMinutes * MINUTE || age > 24 * HOUR) continue;
    await notify({
      type: 'lead.unassigned', priority: 'urgent', brandId,
      userIds: await adminsOf(brandId),
      title: `${c.name} belum punya PIC lebih dari ${SLA.unassignedLeadMinutes} menit`,
      body: 'Tugaskan PIC atau minta CS mengklaim dari antrean.',
      link: '/pipeline?pic=none', entity: { type: 'prospect', id: c.id },
      activeKey: `lead.unassigned:p${c.id}`,
      dedupeKey: `lead.unassigned:p${c.id}:${SLA.unassignedLeadMinutes}m`,
    });
  }
}

// ── Perangkat WA & gateway ──────────────────────────────────────────────────────

/** Cadangan untuk timer di proses: perangkat yang masih terputus lebih dari 2 menit (sampai 24 jam terakhir). */
export async function whatsappDisconnectedJob(now = new Date()) {
  const sessions = await prisma.whatsappSession.findMany({
    where: {
      status: { not: 'connected' },
      updatedAt: { lte: new Date(now.getTime() - SLA.waGraceMinutes * MINUTE), gte: new Date(now.getTime() - 24 * HOUR) },
    },
    select: { brandId: true },
  });
  for (const s of sessions) await notifyWhatsappDisconnected(s.brandId);
}

let gatewayFailures = 0;
let gatewayOutageSince: number | null = null;

export async function gatewayHealthJob(now = new Date(), probe = defaultProbe) {
  const healthy = await probe();
  const superadmins = async () => (await prisma.user.findMany({ where: { role: 'superadmin', isActive: true }, select: { id: true } })).map((u) => u.id);
  if (healthy) {
    gatewayFailures = 0;
    if (gatewayOutageSince !== null) {
      gatewayOutageSince = null;
      await resolveNotifications({ entity: { type: 'system', id: 0 }, types: ['system.gateway_down'] });
      await notify({
        type: 'system.gateway_up', priority: 'info', userIds: await superadmins(),
        title: 'Gateway WhatsApp aktif kembali', link: '/devices', entity: { type: 'system', id: 0 },
      });
    }
    return;
  }
  gatewayFailures++;
  // Dua pemeriksaan berturut-turut gagal (±2 menit) sebelum dianggap mati.
  if (gatewayFailures < 2 || gatewayOutageSince !== null) return;
  gatewayOutageSince = now.getTime();
  await notify({
    type: 'system.gateway_down', priority: 'urgent', userIds: await superadmins(),
    title: 'Gateway WhatsApp tidak merespons',
    body: 'Semua brand tidak dapat menerima atau mengirim pesan WhatsApp. Periksa proses wa-gateway.',
    link: '/devices', entity: { type: 'system', id: 0 }, activeKey: 'system.gateway_down',
  });
}

async function defaultProbe() {
  try {
    const response = await fetch(`${env.WA_GATEWAY_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Untuk tes. */
export function resetGatewayState() {
  gatewayFailures = 0;
  gatewayOutageSince = null;
}

// ── Bukti transfer menunggu terlalu lama ────────────────────────────────────────

export async function proofStaleJob(now = new Date()) {
  const rows = await prisma.prospect.findMany({
    where: {
      paymentProofUrl: { not: null },
      status: { notIn: [...lostStatuses] },
      paymentProofSubmittedAt: { lte: new Date(now.getTime() - SLA.proofStaleHours * HOUR), gte: new Date(now.getTime() - 7 * 24 * HOUR) },
    },
    select: {
      id: true, brandId: true, name: true, paymentProofUrl: true, paymentProofSubmittedAt: true,
      brand: { select: { name: true } },
      payments: { select: { proofUrl: true } },
    },
  });
  // Sama dengan antrean Finance: bukti yang sudah dipakai pembayaran terverifikasi tidak lagi menunggu.
  const waiting = rows.filter((p) => !p.payments.some((pay) => pay.proofUrl === p.paymentProofUrl));
  for (const p of waiting) {
    const submittedAt = p.paymentProofSubmittedAt!;
    const hours = Math.floor((now.getTime() - submittedAt.getTime()) / HOUR);
    const escalate = hours >= SLA.proofEscalationHours;
    await notify({
      type: 'payment.proof_stale', priority: 'urgent', brandId: p.brandId,
      userIds: escalate ? [...await financeUsers(), ...await adminsOf(p.brandId)] : await financeUsers(),
      title: `Bukti transfer ${p.name} menunggu ${hours} jam`,
      body: `${p.brand.name} · ${escalate ? 'lewat 1 hari, perlu perhatian Admin' : `lewat ${SLA.proofStaleHours} jam`}. Verifikasi atau tolak dengan alasan.`,
      link: '/verifikasi', entity: { type: 'prospect', id: p.id },
      dedupeKey: `payment.proof_stale:p${p.id}:${submittedAt.getTime()}:${escalate ? 2 : 1}`,
    });
  }
}

// ── Ringkasan pagi (08.00 WIB): follow-up, invoice lewat tempo, brand tanpa CS ───

export async function morningDigestJob(now = new Date()) {
  const today = businessDateKey(now);

  const followups = await prisma.prospect.findMany({
    where: { userId: { not: null }, status: { notIn: CLOSED }, nextFollowupDate: { not: null, lte: new Date(`${today}T00:00:00.000Z`) } },
    select: { userId: true, nextFollowupDate: true },
  });
  const perUser = new Map<number, { today: number; overdue: number }>();
  for (const f of followups) {
    const key = dateOnlyKey(f.nextFollowupDate);
    if (!key || key > today) continue;
    const entry = perUser.get(f.userId!) ?? { today: 0, overdue: 0 };
    if (key === today) entry.today++; else entry.overdue++;
    perUser.set(f.userId!, entry);
  }
  const activeCs = new Set((await prisma.user.findMany({ where: { role: 'cs', isActive: true }, select: { id: true } })).map((u) => u.id));
  for (const [userId, counts] of perUser) {
    if (!activeCs.has(userId)) continue;
    if (counts.today) {
      await notify({
        type: 'followup.due_today', priority: 'action', userIds: [userId],
        title: `${counts.today} follow-up hari ini`, body: 'Jadwal follow-up jamaah yang Anda tangani.',
        link: '/pipeline?quick=today&pic=mine', dedupeKey: `followup.due_today:u${userId}:${today}`,
      });
    }
    if (counts.overdue) {
      await notify({
        type: 'followup.overdue', priority: 'action', userIds: [userId],
        title: `${counts.overdue} follow-up terlambat`, body: 'Hubungi jamaah lalu perbarui tanggal follow-up berikutnya.',
        link: '/pipeline?quick=overdue&pic=mine', dedupeKey: `followup.overdue:u${userId}:${today}`,
      });
    }
  }

  const invoices = await prisma.prospect.findMany({
    where: { status: 'closing', invoiceDueAt: { lt: now, gte: new Date(now.getTime() - 30 * 24 * HOUR) } },
    select: { id: true, brandId: true, name: true, userId: true, invoiceNumber: true, invoiceDueAt: true, brand: { select: { name: true } } },
  });
  const perBrand = new Map<number, { name: string; count: number }>();
  for (const inv of invoices) {
    await notify({
      type: 'invoice.overdue', priority: 'action', brandId: inv.brandId,
      userIds: await picOf({ userId: inv.userId, brandId: inv.brandId }),
      title: `Invoice ${inv.name} lewat jatuh tempo`,
      body: `${inv.invoiceNumber ?? 'Invoice'} belum dibayar. Ingatkan jamaah atau perbarui jatuh tempo.`,
      link: inboxLink(inv), entity: { type: 'prospect', id: inv.id },
      dedupeKey: `invoice.overdue:p${inv.id}:${inv.invoiceDueAt!.getTime()}`,
    });
    const entry = perBrand.get(inv.brandId) ?? { name: inv.brand.name, count: 0 };
    entry.count++;
    perBrand.set(inv.brandId, entry);
  }
  for (const [brandId, entry] of perBrand) {
    await notify({
      type: 'invoice.overdue_digest', priority: 'info', brandId, userIds: await financeUsers(),
      title: `${entry.count} invoice lewat jatuh tempo (${entry.name})`,
      body: 'Belum ada pembayaran terverifikasi. Pantau bukti yang masuk di antrean verifikasi.',
      link: '/verifikasi', entity: { type: 'brand', id: brandId },
      dedupeKey: `invoice.overdue_digest:b${brandId}:${today}`,
    });
  }

  const brands = await prisma.brand.findMany({
    select: { id: true, name: true, _count: { select: { users: { where: { role: 'cs', isActive: true } } } }, userBrands: { where: { user: { role: 'cs', isActive: true } }, select: { userId: true } } },
  });
  for (const brand of brands) {
    if (brand._count.users > 0 || brand.userBrands.length > 0) continue;
    await notify({
      type: 'brand.no_active_cs', priority: 'action', brandId: brand.id, userIds: await adminsOf(brand.id),
      title: `${brand.name} tidak punya CS aktif`,
      body: 'Lead baru dari WhatsApp tidak akan punya PIC. Tambahkan atau aktifkan CS di menu Staff.',
      link: '/staff', entity: { type: 'brand', id: brand.id },
      dedupeKey: `brand.no_active_cs:b${brand.id}:${today}`,
    });
  }
}

// ── Ringkasan sore (17.00 WIB): pengambilalihan PIC hari ini ────────────────────

export async function eveningDigestJob(now = new Date()) {
  const today = businessDateKey(now);
  const logs = await prisma.prospectLog.findMany({
    where: { actionType: 'pic_taken_over', createdAt: { gte: new Date(`${today}T00:00:00+07:00`), lte: now } },
    select: { title: true, prospect: { select: { brandId: true } } },
  });
  const perBrand = new Map<number, Map<string, number>>();
  for (const log of logs) {
    // Judul log: "PIC diambil alih oleh X dari Y" → hitung per PIC lama (bahan coaching).
    const from = /dari (.+)$/.exec(log.title)?.[1] ?? 'PIC sebelumnya';
    const byPic = perBrand.get(log.prospect.brandId) ?? new Map<string, number>();
    byPic.set(from, (byPic.get(from) ?? 0) + 1);
    perBrand.set(log.prospect.brandId, byPic);
  }
  for (const [brandId, byPic] of perBrand) {
    const total = [...byPic.values()].reduce((a, b) => a + b, 0);
    const detail = [...byPic].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name}: ${n}`).join(', ');
    await notify({
      type: 'pic.taken_over_digest', priority: 'info', brandId, userIds: await adminsOf(brandId),
      title: `${total} prospek diambil alih hari ini`,
      body: `Jamaah belum dibalas 15 menit oleh PIC. ${detail}`,
      link: '/staff', entity: { type: 'brand', id: brandId },
      dedupeKey: `pic.taken_over_digest:b${brandId}:${today}`,
    });
  }
}

// ── Retensi (03.00 WIB) ─────────────────────────────────────────────────────────

export async function retentionJob(now = new Date()) {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * HOUR);
  const [read, unread, dedupes, ticks] = await Promise.all([
    prisma.notification.deleteMany({ where: { readAt: { lt: daysAgo(60) } } }),
    prisma.notification.deleteMany({ where: { readAt: null, createdAt: { lt: daysAgo(180) } } }),
    prisma.notificationDedupe.deleteMany({ where: { createdAt: { lt: daysAgo(14) } } }),
    prisma.notificationDedupe.deleteMany({ where: { key: { startsWith: 'scheduler:' }, createdAt: { lt: daysAgo(1) } } }),
  ]);
  return { read: read.count, unread: unread.count, dedupes: dedupes.count + ticks.count };
}
