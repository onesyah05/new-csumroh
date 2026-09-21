import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const contactsRouter = Router();
contactsRouter.use(authGuard);

const contactInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(30),
  city: z.string().trim().max(100).nullable().optional(),
  brandId: z.coerce.number().int().positive().optional(),
});

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function phoneAliases(value: string) {
  const phone = normalizePhone(value);
  return [...new Set([phone, `+${phone}`, phone.startsWith('62') ? `0${phone.slice(2)}` : phone])];
}

contactsRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const search = String(req.query.search ?? '').trim();
  const contacts = await prisma.prospect.findMany({
    where: {
      brandId,
      ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { city: { contains: search } }] } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      city: true,
      photoUrl: true,
      leadSource: true,
      status: true,
      remoteJid: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true } },
      _count: { select: { messages: { where: { isDeleted: false } } } },
      messages: { where: { isDeleted: false }, orderBy: { timestamp: 'desc' }, take: 1, select: { messageText: true, messageType: true, timestamp: true, isFromMe: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const grouped = new Map<string, typeof contacts>();
  for (const contact of contacts) {
    const phone = contact.phone ? normalizePhone(contact.phone) : '';
    const key = phone ? `phone:${phone}` : `jid:${contact.remoteJid ?? contact.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), contact]);
  }
  const data = [...grouped.values()].map((group) => {
    const canonical = [...group].sort((a, b) => {
      const aNamed = /^\+?\d+$/.test(a.name.trim()) ? 0 : 1;
      const bNamed = /^\+?\d+$/.test(b.name.trim()) ? 0 : 1;
      return bNamed - aNamed || b._count.messages - a._count.messages || b.updatedAt.getTime() - a.updatedAt.getTime();
    })[0]!;
    const latest = group.flatMap((item) => item.messages).sort((a, b) => b.timestamp - a.timestamp)[0];
    return { ...canonical, messages: latest ? [latest] : [], messageCount: group.reduce((sum, item) => sum + item._count.messages, 0), duplicateIds: group.map((item) => item.id) };
  }).sort((a, b) => (b.messages[0]?.timestamp ?? b.updatedAt.getTime() / 1000) - (a.messages[0]?.timestamp ?? a.updatedAt.getTime() / 1000));

  res.json({ success: true, data });
}));

contactsRouter.post('/', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const input = contactInputSchema.parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);
  const phone = normalizePhone(input.phone);
  if (phone.length < 8) throw new HttpError(422, 'Nomor WhatsApp tidak valid.');
  const existing = await prisma.prospect.findFirst({ where: { brandId, phone: { in: phoneAliases(phone) } }, select: { id: true } });
  if (existing) throw new HttpError(409, 'Kontak dengan nomor WhatsApp tersebut sudah tersedia.');
  const contact = await prisma.prospect.create({
    data: { brandId, name: input.name, phone, city: input.city || null, remoteJid: `${phone}@s.whatsapp.net`, leadSource: 'manual' },
    include: { user: { select: { id: true, name: true } } },
  });
  await prisma.prospectLog.create({ data: { prospectId: contact.id, userId: req.user!.id, actionType: 'contact_created', title: `Kontak ditambahkan oleh ${req.user!.name}` } });
  emitToBrand(brandId, 'contacts:synced', { imported: 1, contactId: contact.id });
  res.status(201).json({ success: true, data: contact });
}));
