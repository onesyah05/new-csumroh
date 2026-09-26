import { lostStatuses, wonStatuses } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { emitToUser } from '../../realtime/socket.js';
import { notify, resolveNotifications } from './notify.service.js';
import { adminsOf, csOfBrand, financeOrAdmins, financeUsers, picOf, productOrSuperadmins, productUsers } from './recipients.js';

/**
 * Notifikasi per kejadian bisnis. Dipanggil SETELAH transaksi selesai; semua fungsi aman dipanggil
 * dengan `void` karena `notify` tidak pernah melempar error.
 */

/**
 * Jalankan notifikasi di latar belakang setelah respons bisnis: error (mis. DB saat mencari penerima)
 * hanya dicatat dan tidak pernah memengaruhi tindakan yang memicunya.
 */
export function dispatch(task: () => Promise<unknown>) {
  void task().catch((error) => console.error('Notifikasi gagal diproses', error));
}

type ProspectRef = { id: number; brandId: number; name: string; userId?: number | null };
type Actor = { id: number; name: string };

const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;
const inboxLink = (p: ProspectRef) => `/inbox?prospectId=${p.id}&brandId=${p.brandId}`;
const detailLink = (p: ProspectRef) => `/prospects/${p.id}`;
const prospectEntity = (p: ProspectRef) => ({ type: 'prospect' as const, id: p.id });

async function brandName(brandId: number) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } }).catch(() => null);
  return brand?.name ?? `Brand ${brandId}`;
}

// ── Lead & pesan masuk ──────────────────────────────────────────────────────────

export async function notifyLeadAssigned(p: ProspectRef, assigneeId: number) {
  return notify({
    type: 'lead.assigned', priority: 'action', brandId: p.brandId,
    userIds: await picOf({ userId: assigneeId, brandId: p.brandId }),
    title: `Lead baru: ${p.name}`,
    body: 'Anda ditetapkan sebagai PIC. Balas jamaah secepatnya.',
    link: inboxLink(p), entity: prospectEntity(p), activeKey: `lead.assigned:p${p.id}`,
  });
}

export async function notifyLeadUnassigned(p: ProspectRef) {
  return notify({
    type: 'lead.unassigned', priority: 'urgent', brandId: p.brandId,
    userIds: await adminsOf(p.brandId),
    title: `Lead baru tanpa PIC: ${p.name}`,
    body: `${await brandName(p.brandId)}: tidak ada CS aktif yang menerima lead ini. Tugaskan PIC.`,
    link: '/pipeline?pic=none', entity: prospectEntity(p), activeKey: `lead.unassigned:p${p.id}`,
  });
}

const MEDIA_LABELS: Record<string, string> = {
  imageMessage: 'Mengirim gambar', videoMessage: 'Mengirim video', audioMessage: 'Mengirim pesan suara',
  documentMessage: 'Mengirim dokumen', stickerMessage: 'Mengirim stiker', locationMessage: 'Mengirim lokasi', contactMessage: 'Mengirim kontak',
};

/** Pesan jamaah untuk PIC; diringkas per prospek sampai dibaca atau dibalas. */
export async function notifyInboundMessage(p: ProspectRef, message: { text?: string | null; messageType?: string | null }) {
  if (!p.userId) return 0;
  const preview = message.text?.trim() || MEDIA_LABELS[message.messageType ?? ''] || 'Pesan baru';
  return notify({
    type: 'message.inbound', priority: 'info', brandId: p.brandId,
    userIds: await picOf({ userId: p.userId, brandId: p.brandId }),
    title: `Pesan baru dari ${p.name}`,
    body: preview.length > 80 ? `${preview.slice(0, 79)}…` : preview,
    link: inboxLink(p), entity: prospectEntity(p), activeKey: `message.inbound:p${p.id}`,
  });
}

/** Balasan terkirim atau chat dibaca: pengingat balasan untuk prospek ini selesai. */
export function resolveReplyNotifications(prospectId: number) {
  return resolveNotifications({
    entity: { type: 'prospect', id: prospectId },
    types: ['message.inbound', 'lead.assigned', 'reply.sla_warning', 'reply.escalation'],
  });
}

// ── Perubahan PIC ───────────────────────────────────────────────────────────────

export async function notifyPicChange(input: {
  prospect: ProspectRef;
  kind: 'claimed' | 'assigned' | 'handover' | 'taken_over';
  fromUserId: number | null;
  toUserId: number | null;
  actor: Actor;
  toName?: string | null;
  reason?: string;
  waitedMinutes?: number;
}) {
  const { prospect: p, kind, fromUserId, toUserId, actor } = input;
  // Prospek sudah punya penanggung jawab: antrean tanpa PIC selesai. Pengingat milik PIC lama tidak relevan lagi.
  if (toUserId) await resolveNotifications({ entity: prospectEntity(p), types: ['lead.unassigned'] });
  if (fromUserId && fromUserId !== toUserId) {
    await resolveNotifications({ entity: prospectEntity(p), types: ['message.inbound', 'lead.assigned'], userIds: [fromUserId] });
  }

  if (toUserId && kind !== 'claimed' && kind !== 'taken_over') {
    const handover = kind === 'handover';
    await notify({
      type: handover ? 'pic.handover_received' : 'pic.assigned', priority: 'action', brandId: p.brandId, actorId: actor.id,
      userIds: await picOf({ userId: toUserId, brandId: p.brandId }),
      title: handover ? `${actor.name} menyerahkan ${p.name} kepada Anda` : `Anda ditugaskan sebagai PIC ${p.name}`,
      body: handover ? (input.reason ? `Alasan: ${input.reason}` : null) : `Oleh ${actor.name}`,
      link: inboxLink(p), entity: prospectEntity(p),
    });
  }

  if (fromUserId && fromUserId !== toUserId) {
    const takenOver = kind === 'taken_over';
    await notify({
      type: takenOver ? 'pic.taken_over' : 'pic.released', priority: takenOver ? 'urgent' : 'info', brandId: p.brandId, actorId: actor.id,
      userIds: [fromUserId],
      title: takenOver
        ? `${p.name} diambil alih ${actor.name}`
        : toUserId ? `${p.name} dialihkan ke ${input.toName ?? 'CS lain'}` : `${p.name} dilepas ke antrean`,
      body: takenOver
        ? `Jamaah belum dibalas ${input.waitedMinutes ?? 15} menit. Anda tidak lagi menjadi PIC prospek ini.`
        : `Oleh ${actor.name}${input.reason ? ` · ${input.reason}` : ''}`,
      link: detailLink(p), entity: prospectEntity(p),
    });
  }
}

/** Admin lain perlu tahu bila banyak prospek kembali ke antrean karena perubahan staf. */
export async function notifyProspectsReleased(rows: { id: number; brandId: number }[], actor: Actor, reason: string) {
  for (const brandId of new Set(rows.map((r) => r.brandId))) {
    const count = rows.filter((r) => r.brandId === brandId).length;
    await notify({
      type: 'staff.prospects_released', priority: 'info', brandId, actorId: actor.id,
      userIds: await adminsOf(brandId),
      title: `${count} prospek kembali ke antrean tanpa PIC`,
      body: `${await brandName(brandId)}: ${reason} (oleh ${actor.name})`,
      link: '/pipeline?pic=none', entity: { type: 'brand', id: brandId },
    });
  }
}

// ── Pembayaran & booking ────────────────────────────────────────────────────────

const PROOF_SUMMARY_KEY = 'payment.proof_new';
const PROOF_SUMMARY_TITLE = 'Bukti transfer menunggu verifikasi';

/** Jumlah bukti transfer yang menunggu verifikasi (semua brand), sama dengan antrean Finance. */
async function pendingProofCount() {
  const rows = await prisma.prospect.findMany({
    where: { paymentProofUrl: { not: null }, status: { notIn: [...wonStatuses, ...lostStatuses] } },
    select: { paymentProofUrl: true, payments: { select: { proofUrl: true } } },
  });
  return rows.filter((p) => !p.payments.some((pay) => pay.proofUrl === p.paymentProofUrl)).length;
}

/**
 * Finance menerima SATU ringkasan antrean ("Bukti transfer menunggu verifikasi (12)"), bukan satu
 * notifikasi per prospek: halaman Verifikasi adalah daftar kerjanya. Bukti yang terlalu lama tetap
 * dilaporkan per prospek oleh job `payment.proof_stale`.
 */
export async function notifyProofSubmitted(p: ProspectRef, actor: Actor, fromChat: boolean) {
  // Bukti baru menggantikan bukti yang ditolak.
  await resolveNotifications({ entity: prospectEntity(p), types: ['payment.rejected'] });
  const pending = await pendingProofCount();
  return notify({
    type: 'payment.proof_new', priority: 'action', brandId: p.brandId, actorId: actor.id,
    userIds: await financeOrAdmins(p.brandId),
    title: PROOF_SUMMARY_TITLE,
    body: `${pending} bukti menunggu · terbaru: ${p.name} (${await brandName(p.brandId)}), ${fromChat ? 'dari chat WhatsApp' : 'diunggah'} oleh ${actor.name}`,
    link: '/verifikasi', activeKey: PROOF_SUMMARY_KEY, setCount: pending,
  });
}

/** Setelah verifikasi/penolakan: perbarui angka ringkasan tanpa toast baru, atau tutup bila antrean kosong. */
export async function refreshProofSummary() {
  const pending = await pendingProofCount();
  if (pending === 0) return resolveNotifications({ types: ['payment.proof_new'] });
  const rows = await prisma.notification.findMany({
    where: { type: 'payment.proof_new', activeKey: PROOF_SUMMARY_KEY, resolvedAt: null },
    select: { id: true, userId: true },
  });
  if (!rows.length) return 0;
  await prisma.notification.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { count: pending, body: `${pending} bukti menunggu verifikasi` },
  });
  for (const row of rows) emitToUser(row.userId, 'notification:updated', { ids: [row.id] });
  return rows.length;
}

export async function notifyPaymentVerified(input: {
  prospect: ProspectRef; actor: Actor; amount: number; paymentType: 'dp' | 'full';
}) {
  const { prospect: p, actor } = input;
  await resolveNotifications({ entity: prospectEntity(p), types: ['payment.proof_new', 'payment.proof_stale'] });
  await refreshProofSummary();
  await notify({
    type: 'payment.verified', priority: 'info', brandId: p.brandId, actorId: actor.id,
    userIds: await picOf({ userId: p.userId ?? null, brandId: p.brandId }),
    title: `Deal! Pembayaran awal ${p.name} diverifikasi`,
    body: `${input.paymentType === 'full' ? 'Pembayaran awal lunas' : 'Pembayaran awal DP'} · ${rupiah(input.amount)}. Penanganan CS selesai.`,
    link: detailLink(p), entity: prospectEntity(p),
  });

}

/** Finance menolak bukti: PIC harus meminta bukti yang benar ke jamaah. */
export async function notifyProofRejected(input: { prospect: ProspectRef; actor: Actor; reason: string }) {
  const { prospect: p, actor } = input;
  await resolveNotifications({ entity: prospectEntity(p), types: ['payment.proof_new', 'payment.proof_stale'] });
  await refreshProofSummary();
  return notify({
    type: 'payment.rejected', priority: 'urgent', brandId: p.brandId, actorId: actor.id,
    userIds: await picOf({ userId: p.userId ?? null, brandId: p.brandId }),
    title: `Bukti transfer ${p.name} ditolak`,
    body: `${input.reason} · oleh ${actor.name}. Minta bukti yang benar ke jamaah.`,
    link: inboxLink(p), entity: prospectEntity(p),
  });
}

/** Setelah seat terpakai: PIC yang sedang menawarkan paket ini dan Admin (bila habis) diberi tahu. */
export async function notifyQuotaAfterBooking(packageId: number, actor: Actor, lowThreshold = 5) {
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { id: true, name: true, brandId: true, quotaRemaining: true } });
  if (!pkg || pkg.quotaRemaining === null || pkg.quotaRemaining > lowThreshold) return;
  const empty = pkg.quotaRemaining <= 0;
  const [openPics, brandCs] = await Promise.all([
    prisma.prospect.findMany({
      where: { packageId: pkg.id, userId: { not: null }, status: { notIn: [...wonStatuses, ...lostStatuses] } },
      select: { userId: true }, distinct: ['userId'],
    }),
    csOfBrand(pkg.brandId),
  ]);
  const pics = openPics.map((r) => r.userId!).filter((id) => brandCs.includes(id));
  const entity = { type: 'package' as const, id: pkg.id };
  await notify({
    type: 'package.quota_low', priority: 'action', brandId: pkg.brandId, actorId: actor.id, userIds: pics,
    title: empty ? `Kuota ${pkg.name} habis` : `Kuota ${pkg.name} tinggal ${pkg.quotaRemaining} seat`,
    body: empty ? 'Tawarkan paket lain kepada jamaah yang sedang Anda tangani.' : 'Segera arahkan jamaah yang sedang Anda tawari untuk membayar DP.',
    link: `/packages/${pkg.id}`, entity, activeKey: `package.quota_low:k${pkg.id}`,
  });
  if (empty) {
    await notify({
      type: 'package.quota_empty', priority: 'action', brandId: pkg.brandId, actorId: actor.id,
      userIds: await adminsOf(pkg.brandId),
      title: `Kuota ${pkg.name} habis`,
      body: `${await brandName(pkg.brandId)}: tambah kuota atau nonaktifkan paket.`,
      link: `/packages/${pkg.id}`, entity, activeKey: `package.quota_empty:k${pkg.id}`,
    });
  }
}

export async function notifyBookingCancelled(input: { prospect: ProspectRef; actor: Actor; reason?: string | null }) {
  const { prospect: p, actor } = input;
  await notify({
    type: 'booking.cancelled', priority: 'action', brandId: p.brandId, actorId: actor.id,
    userIds: await picOf({ userId: p.userId ?? null, brandId: p.brandId }),
    title: `Booking ${p.name} dibatalkan`,
    body: `Oleh ${actor.name}${input.reason ? ` · ${input.reason}` : ''}`,
    link: detailLink(p), entity: prospectEntity(p),
  });

}

// ── Perangkat WhatsApp & Meta CAPI ──────────────────────────────────────────────

export const WA_DISCONNECT_GRACE_MS = 2 * 60_000;
const waTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Status perangkat dari gateway. Kedipan singkat (reconnect otomatis) tidak dilaporkan: notifikasi hanya
 * dikirim bila perangkat masih tidak terhubung setelah 2 menit. Tersambung lagi menutup notifikasi itu.
 */
export function onWhatsappStatus(brandId: number, status: string, graceMs = WA_DISCONNECT_GRACE_MS) {
  if (status === 'connected') {
    const timer = waTimers.get(brandId);
    if (timer) clearTimeout(timer);
    waTimers.delete(brandId);
    return notifyWhatsappReconnected(brandId);
  }
  if (waTimers.has(brandId)) return Promise.resolve(0);
  const timer = setTimeout(() => {
    waTimers.delete(brandId);
    void notifyWhatsappDisconnected(brandId);
  }, graceMs);
  timer.unref?.();
  waTimers.set(brandId, timer);
  return Promise.resolve(0);
}

/**
 * Satu notifikasi per kejadian putus: kunci dedupe memakai waktu perubahan status terakhir, sehingga
 * timer di proses dan job terjadwal tidak mengirim dua kali untuk kejadian yang sama.
 */
export async function notifyWhatsappDisconnected(brandId: number) {
  const session = await prisma.whatsappSession.findUnique({ where: { brandId }, select: { status: true, updatedAt: true } }).catch(() => null);
  if (!session || session.status === 'connected') return 0;
  return notify({
    dedupeKey: `wa.disconnected:b${brandId}:${session.updatedAt.getTime()}`,
    type: 'wa.disconnected', priority: 'urgent', brandId,
    userIds: await adminsOf(brandId),
    title: `WhatsApp ${await brandName(brandId)} terputus`,
    body: 'Perangkat tidak terhubung lebih dari 2 menit. Pesan jamaah dan balasan CS tertunda.',
    link: `/devices/${brandId}`, entity: { type: 'brand', id: brandId }, activeKey: `wa.disconnected:b${brandId}`,
  });
}

async function notifyWhatsappReconnected(brandId: number) {
  const open = await prisma.notification.findMany({
    where: { type: 'wa.disconnected', entityType: 'brand', entityId: brandId, resolvedAt: null },
    select: { userId: true },
  }).catch(() => []);
  if (!open.length) return 0;
  await resolveNotifications({ entity: { type: 'brand', id: brandId }, types: ['wa.disconnected'] });
  return notify({
    type: 'wa.reconnected', priority: 'info', brandId,
    userIds: open.map((r) => r.userId),
    title: `WhatsApp ${await brandName(brandId)} tersambung lagi`,
    link: `/devices/${brandId}`, entity: { type: 'brand', id: brandId },
  });
}

export async function notifyCapiFailed(brandId: number, reason: string) {
  return notify({
    type: 'capi.failed', priority: 'info', brandId,
    userIds: await adminsOf(brandId),
    title: `Event Meta CAPI gagal (${await brandName(brandId)})`,
    body: reason.length > 160 ? `${reason.slice(0, 159)}…` : reason,
    link: '/meta-capi', entity: { type: 'brand', id: brandId }, activeKey: `capi.failed:b${brandId}`,
  });
}

// ── Layanan custom ──
const customLink = (requestId: number) => `/layanan-custom?id=${requestId}`;

/** Permintaan baru atau hitung ulang masuk ke antrean Tim LA (semua brand). */
export async function notifyCustomSubmitted(input: { prospect: ProspectRef; actor: Actor; requestId: number; revision?: boolean }) {
  const { prospect: p, actor } = input;
  await resolveNotifications({ entity: prospectEntity(p), types: ['custom.quoted', 'custom.returned', 'custom.expiring'] });
  return notify({
    type: input.revision ? 'custom.revision' : 'custom.submitted', priority: 'action', brandId: p.brandId, actorId: actor.id,
    userIds: await productOrSuperadmins(),
    title: input.revision ? `Hitung ulang layanan custom: ${p.name}` : `Permintaan layanan custom: ${p.name}`,
    body: `${await brandName(p.brandId)} · dikirim ${actor.name}`,
    link: customLink(input.requestId), entity: prospectEntity(p), activeKey: `custom:r${input.requestId}`,
  });
}

/** Tim LA mengembalikan permintaan: PIC melengkapi kebutuhan. */
export async function notifyCustomReturned(input: { prospect: ProspectRef; actor: Actor; requestId: number; note: string }) {
  const { prospect: p, actor } = input;
  await resolveNotifications({ entity: prospectEntity(p), types: ['custom.submitted', 'custom.revision'] });
  return notify({
    type: 'custom.returned', priority: 'action', brandId: p.brandId, actorId: actor.id,
    userIds: await picOf({ userId: p.userId ?? null, brandId: p.brandId }),
    title: `Layanan custom ${p.name} perlu dilengkapi`,
    body: `${actor.name}: ${input.note}`.slice(0, 240),
    link: inboxLink(p), entity: prospectEntity(p), activeKey: `custom.returned:p${p.id}`,
  });
}

/** CS mengubah kebutuhan yang sedang dihitung Tim LA. */
export async function notifyCustomUpdated(input: { prospect: ProspectRef; actor: Actor; requestId: number }) {
  const { prospect: p, actor } = input;
  return notify({
    type: 'custom.updated', priority: 'action', brandId: p.brandId, actorId: actor.id,
    userIds: await productOrSuperadmins(),
    title: `Kebutuhan custom ${p.name} diubah`,
    body: `${actor.name} mengubah kebutuhan jamaah. Muat ulang rincian sebelum menghitung.`,
    link: customLink(input.requestId), entity: prospectEntity(p), activeKey: `custom.updated:r${input.requestId}`,
  });
}

/** Prospek batal: permintaan custom ikut dibatalkan, notifikasi Tim LA untuk prospek itu ditutup. */
export function closeCustomNotifications(p: ProspectRef) {
  return resolveNotifications({ entity: prospectEntity(p), types: ['custom.submitted', 'custom.revision', 'custom.updated', 'custom.expiring', 'custom.returned', 'custom.quoted'] });
}

/** CS menyepakati nilai deal: Tim LA tahu hasil negosiasinya. */
export async function notifyCustomAgreed(input: { prospect: ProspectRef; actor: Actor; requestId: number; agreedPrice: number }) {
  const { prospect: p, actor } = input;
  return notify({
    type: 'custom.agreed', priority: 'info', brandId: p.brandId, actorId: actor.id,
    userIds: await productUsers(),
    title: `Harga custom ${p.name} disepakati`,
    body: `${rupiah(input.agreedPrice)} oleh ${actor.name} · ${await brandName(p.brandId)}`,
    link: customLink(input.requestId), entity: prospectEntity(p), activeKey: `custom.agreed:r${input.requestId}`,
  });
}

/** Deal (pembayaran awal terverifikasi) untuk prospek layanan custom: Tim LA menyiapkan pemesanan vendor. */
export async function notifyCustomDeal(input: { prospect: ProspectRef; actor: Actor; requestId: number }) {
  const { prospect: p, actor } = input;
  return notify({
    type: 'custom.deal', priority: 'info', brandId: p.brandId, actorId: actor.id,
    userIds: await productUsers(),
    title: `Deal layanan custom: ${p.name}`,
    body: `Pembayaran awal diverifikasi · ${await brandName(p.brandId)}. Siapkan pemesanan vendor.`,
    link: customLink(input.requestId), entity: prospectEntity(p), activeKey: `custom.deal:r${input.requestId}`,
  });
}

/** Harga sudah dihitung: PIC melanjutkan negosiasi. */
export async function notifyCustomQuoted(input: { prospect: ProspectRef; actor: Actor; requestId: number; offeredPrice: number }) {
  const { prospect: p, actor } = input;
  await resolveNotifications({ entity: prospectEntity(p), types: ['custom.submitted', 'custom.revision'] });
  return notify({
    type: 'custom.quoted', priority: 'action', brandId: p.brandId, actorId: actor.id,
    userIds: await picOf({ userId: p.userId ?? null, brandId: p.brandId }),
    title: `Harga custom ${p.name} sudah dihitung`,
    body: `Ditawarkan ${rupiah(input.offeredPrice)} oleh ${actor.name}. Lanjutkan negosiasi dengan jamaah.`,
    link: inboxLink(p), entity: prospectEntity(p), activeKey: `custom.quoted:p${p.id}`,
  });
}
