import { prisma } from '../../db/prisma.js';

/** Edit beruntun pada pesan yang sama dalam jendela ini digabung menjadi satu baris log. */
const COALESCE_MS = 5 * 60_000;
const clip = (text: string) => text.slice(0, 300);
const DESCRIPTION = /^Sebelum: ([\s\S]*)$/;

const describe = (before: string, after: string) => `Sebelum: ${clip(before)}\nSesudah: ${clip(after)}`;

/** "Sebelum" dan "Sesudah" dari deskripsi log; null bila bukan bentuk yang kita tulis. */
function parseDescription(description: string | null) {
  if (!description || !DESCRIPTION.test(description)) return null;
  const cut = description.lastIndexOf('\nSesudah: ');
  if (cut < 0) return null;
  return { before: description.slice('Sebelum: '.length, cut), after: description.slice(cut + '\nSesudah: '.length) };
}

/**
 * Catat edit yang datang dari WhatsApp (HP brand atau jamaah) di log prospek. Jamaah yang mengedit berkali-kali tidak
 * boleh membanjiri riwayat: bila edit sebelumnya pada pesan yang sama baru terjadi (<= 5 menit), barisnya diperbarui,
 * dengan "Sebelum" tetap versi pertama dan "Sesudah" versi terbaru.
 */
export async function recordInboundEditLog(input: { prospectId: number; fromMe: boolean; previousText: string; nextText: string }, now = Date.now()) {
  const title = input.fromMe ? 'Pesan diedit dari HP brand' : 'Pesan diedit oleh jamaah';
  const recent = await prisma.prospectLog.findFirst({
    where: { prospectId: input.prospectId, actionType: 'message_edited', userId: null, title, createdAt: { gte: new Date(now - COALESCE_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, description: true },
  });
  const previous = parseDescription(recent?.description ?? null);
  // Pesan yang sama: hasil edit sebelumnya adalah teks yang kini diedit lagi.
  if (recent && previous && previous.after === clip(input.previousText)) {
    await prisma.prospectLog.update({ where: { id: recent.id }, data: { description: describe(previous.before, input.nextText) } });
    return 'merged' as const;
  }
  await prisma.prospectLog.create({
    data: { prospectId: input.prospectId, userId: null, actionType: 'message_edited', title, description: describe(input.previousText, input.nextText) },
  });
  return 'created' as const;
}
