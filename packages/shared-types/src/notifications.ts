/**
 * Katalog notifikasi in-app. Dipakai API (tipe yang sah, prioritas default) dan halaman preferensi
 * (label, kelompok, role yang menerimanya). Notifikasi `urgent` selalu tampil sebagai toast.
 */
export type NotificationRole = 'superadmin' | 'admin' | 'cs' | 'finance' | 'product';
export type NotificationPriorityLevel = 'info' | 'action' | 'urgent';

type Entry = {
  type: string;
  group: string;
  label: string;
  description: string;
  priority: NotificationPriorityLevel;
  roles: readonly NotificationRole[];
};

const CS = ['cs'] as const;
const FINANCE = ['finance'] as const;
const MANAGERS = ['admin', 'superadmin'] as const;
const PRODUCT = ['product'] as const;

export const notificationCatalog = [
  // Lead & chat
  { type: 'lead.assigned', group: 'Lead & chat', label: 'Lead baru untuk saya', description: 'Lead WhatsApp baru ditetapkan otomatis kepada Anda.', priority: 'action', roles: CS },
  { type: 'message.inbound', group: 'Lead & chat', label: 'Pesan baru dari jamaah', description: 'Pesan jamaah yang Anda tangani (digabung per percakapan).', priority: 'info', roles: CS },
  { type: 'reply.sla_warning', group: 'Lead & chat', label: 'Jamaah menunggu 10 menit', description: 'Balas sebelum 15 menit agar prospek tidak bisa diambil alih.', priority: 'urgent', roles: CS },
  { type: 'reply.takeover_open', group: 'Lead & chat', label: 'Prospek bisa diambil alih', description: 'Jamaah CS lain belum dibalas lebih dari 15 menit.', priority: 'action', roles: CS },
  { type: 'lead.unassigned', group: 'Lead & chat', label: 'Lead tanpa PIC', description: 'Lead baru tanpa CS aktif, atau belum punya PIC lebih dari 30 menit.', priority: 'urgent', roles: MANAGERS },
  { type: 'reply.escalation', group: 'Lead & chat', label: 'Jamaah belum dibalas 30 menit', description: 'Eskalasi ke Admin untuk ditugaskan ulang.', priority: 'urgent', roles: MANAGERS },
  // PIC
  { type: 'pic.assigned', group: 'PIC', label: 'Ditugaskan sebagai PIC', description: 'Admin menugaskan prospek kepada Anda.', priority: 'action', roles: CS },
  { type: 'pic.handover_received', group: 'PIC', label: 'Menerima serah terima', description: 'CS lain menyerahkan prospek kepada Anda.', priority: 'action', roles: CS },
  { type: 'pic.taken_over', group: 'PIC', label: 'Prospek saya diambil alih', description: 'CS lain mengambil alih karena jamaah belum dibalas 15 menit.', priority: 'urgent', roles: CS },
  { type: 'pic.released', group: 'PIC', label: 'Prospek saya dialihkan/dilepas', description: 'Admin mengalihkan atau melepas prospek Anda.', priority: 'info', roles: CS },
  { type: 'staff.prospects_released', group: 'PIC', label: 'Prospek kembali ke antrean', description: 'Staf dinonaktifkan atau dicabut aksesnya oleh Admin lain.', priority: 'info', roles: MANAGERS },
  { type: 'pic.taken_over_digest', group: 'PIC', label: 'Ringkasan pengambilalihan (17.00)', description: 'Jumlah prospek yang diambil alih hari ini per PIC.', priority: 'info', roles: MANAGERS },
  // Follow-up & invoice
  { type: 'followup.due_today', group: 'Follow-up & invoice', label: 'Follow-up hari ini (08.00)', description: 'Ringkasan jadwal follow-up hari ini.', priority: 'action', roles: CS },
  { type: 'followup.overdue', group: 'Follow-up & invoice', label: 'Follow-up terlambat (08.00)', description: 'Follow-up yang tanggalnya sudah lewat.', priority: 'action', roles: CS },
  { type: 'invoice.overdue', group: 'Follow-up & invoice', label: 'Invoice lewat jatuh tempo', description: 'Invoice prospek Anda belum dibayar setelah jatuh tempo.', priority: 'action', roles: CS },
  // Pembayaran
  { type: 'payment.proof_new', group: 'Pembayaran', label: 'Bukti transfer baru', description: 'Bukti diunggah atau diambil dari chat, menunggu verifikasi. Admin/Superadmin menerimanya bila belum ada Finance aktif.', priority: 'action', roles: ['finance', 'admin', 'superadmin'] },
  { type: 'payment.proof_stale', group: 'Pembayaran', label: 'Bukti menunggu terlalu lama', description: 'Lewat 2 jam (Finance) atau 1 hari (juga Admin).', priority: 'urgent', roles: ['finance', 'admin', 'superadmin'] },
  { type: 'payment.verified', group: 'Pembayaran', label: 'Pembayaran diverifikasi', description: 'Finance memverifikasi pembayaran prospek Anda.', priority: 'info', roles: CS },
  { type: 'payment.rejected', group: 'Pembayaran', label: 'Bukti transfer ditolak', description: 'Finance menolak bukti; minta bukti yang benar ke jamaah.', priority: 'urgent', roles: CS },
  { type: 'booking.cancelled', group: 'Pembayaran', label: 'Booking dibatalkan', description: 'Booking Deal prospek Anda dibatalkan.', priority: 'action', roles: CS },
  // Layanan custom
  { type: 'custom.submitted', group: 'Layanan custom', label: 'Permintaan custom baru', description: 'CS mengirim kebutuhan jamaah untuk dihitung. Superadmin menerimanya bila belum ada Tim LA aktif.', priority: 'action', roles: ['product', 'superadmin'] },
  { type: 'custom.revision', group: 'Layanan custom', label: 'Permintaan hitung ulang', description: 'Kebutuhan jamaah berubah atau harga kedaluwarsa.', priority: 'action', roles: ['product', 'superadmin'] },
  { type: 'custom.quoted', group: 'Layanan custom', label: 'Harga custom sudah dihitung', description: 'Tim LA menetapkan harga untuk jamaah Anda.', priority: 'action', roles: CS },
  { type: 'custom.returned', group: 'Layanan custom', label: 'Permintaan custom dikembalikan', description: 'Tim LA meminta Anda melengkapi kebutuhan jamaah.', priority: 'action', roles: CS },
  { type: 'custom.expiring', group: 'Layanan custom', label: 'Harga custom hampir kedaluwarsa', description: 'Kurang dari 6 jam sebelum harga tidak berlaku.', priority: 'urgent', roles: CS },
  { type: 'custom.updated', group: 'Layanan custom', label: 'Kebutuhan custom diubah CS', description: 'CS mengubah kebutuhan yang sedang dihitung.', priority: 'action', roles: ['product', 'superadmin'] },
  { type: 'custom.agreed', group: 'Layanan custom', label: 'Harga custom disepakati', description: 'CS menyepakati nilai deal dengan jamaah.', priority: 'info', roles: PRODUCT },
  { type: 'custom.deal', group: 'Layanan custom', label: 'Layanan custom Deal', description: 'Pembayaran diverifikasi; siapkan pemesanan vendor.', priority: 'info', roles: PRODUCT },
  // Paket
  { type: 'package.quota_low', group: 'Paket', label: 'Kuota paket menipis', description: 'Paket yang sedang Anda tawarkan tinggal sedikit atau habis.', priority: 'action', roles: CS },
  { type: 'package.quota_empty', group: 'Paket', label: 'Kuota paket habis', description: 'Tambah kuota atau nonaktifkan paket.', priority: 'action', roles: MANAGERS },
  // Sistem & perangkat
  { type: 'wa.disconnected', group: 'Sistem & perangkat', label: 'WhatsApp brand terputus', description: 'Perangkat tidak terhubung lebih dari 2 menit.', priority: 'urgent', roles: MANAGERS },
  { type: 'wa.reconnected', group: 'Sistem & perangkat', label: 'WhatsApp tersambung lagi', description: 'Perangkat yang tadi terputus sudah tersambung.', priority: 'info', roles: MANAGERS },
  { type: 'brand.no_active_cs', group: 'Sistem & perangkat', label: 'Brand tanpa CS aktif (08.00)', description: 'Lead baru tidak akan punya PIC.', priority: 'action', roles: MANAGERS },
  { type: 'capi.failed', group: 'Sistem & perangkat', label: 'Meta CAPI gagal', description: 'Event konversi gagal dikirim ke Meta (digabung per brand).', priority: 'info', roles: MANAGERS },
  { type: 'system.gateway_down', group: 'Sistem & perangkat', label: 'Gateway WhatsApp mati', description: 'Semua brand tidak bisa menerima/mengirim pesan.', priority: 'urgent', roles: ['superadmin'] },
  { type: 'system.gateway_up', group: 'Sistem & perangkat', label: 'Gateway WhatsApp pulih', description: 'Gateway kembali merespons.', priority: 'info', roles: ['superadmin'] },
] as const satisfies readonly Entry[];

export type NotificationType = (typeof notificationCatalog)[number]['type'];
export type NotificationCatalogEntry = (typeof notificationCatalog)[number];

const byType = new Map<string, NotificationCatalogEntry>(notificationCatalog.map((entry) => [entry.type, entry]));

export function notificationEntry(type: string) {
  return byType.get(type);
}

/** Tipe yang relevan untuk sebuah role (dipakai halaman preferensi). */
export function notificationTypesForRole(role: string) {
  return notificationCatalog.filter((entry) => (entry.roles as readonly string[]).includes(role));
}

/**
 * Preferensi efektif. Default: toast untuk Tindakan dan Mendesak, tidak untuk Info; suara mati.
 * Notifikasi Mendesak selalu tampil sebagai toast.
 */
export function effectiveNotificationPreference(type: string, stored?: { toast: boolean; sound: boolean } | null) {
  const priority = notificationEntry(type)?.priority ?? 'info';
  const toast = priority === 'urgent' ? true : stored?.toast ?? priority !== 'info';
  return { toast, sound: stored?.sound ?? false, locked: priority === 'urgent' };
}
