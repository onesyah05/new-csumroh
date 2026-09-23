import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import {
  getLivechatConversationsForBrand,
  normalizePhoneIdentifier,
  chooseCanonicalProspect,
} from '../chat/chat.routes.js';

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

export type ContactDevice = {
  brandId: number;
  brandName: string;
  brandCode: string;
  devicePhone: string | null;
  sessionName: string;
  deviceStatus: 'connected' | 'disconnected' | 'connecting' | 'qr_ready';
  prospectId: number;
  remoteJid: string | null;
  messageCount: number;
  lastActiveAt: string | null;
  isCurrentBrand: boolean;
};

// GET /api/v1/contacts/devices - List connected WhatsApp devices with real livechat contact counts
contactsRouter.get('/devices', asyncHandler(async (req, res) => {
  const brands = await prisma.brand.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      phone: true,
      whatsappSession: {
        select: {
          sessionName: true,
          phoneNumber: true,
          status: true,
          lastConnectedAt: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  const devices = await Promise.all(
    brands.map(async (b) => {
      let realContactCount = 0;
      let messageCount = 0;

      if (b.whatsappSession?.status === 'connected') {
        const conversations = await getLivechatConversationsForBrand(b.id);
        const validContacts = conversations.filter((c) => !c.isOwn && c.remoteJid !== '0@s.whatsapp.net');
        realContactCount = validContacts.length;
        messageCount = validContacts.reduce((sum, c) => sum + (c.messageCount || 0), 0);
      }

      return {
        brandId: b.id,
        brandName: b.name,
        brandCode: b.code,
        devicePhone: b.whatsappSession?.phoneNumber || b.phone || null,
        sessionName: b.whatsappSession?.sessionName || `brand_${b.id}`,
        deviceStatus: b.whatsappSession?.status || 'disconnected',
        lastConnectedAt: b.whatsappSession?.lastConnectedAt,
        realContactCount,
        messageCount,
      };
    })
  );

  res.json({ success: true, data: devices });
}));

// GET /api/v1/contacts - ONLY real contacts with livechat WhatsApp conversations
contactsRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const deviceFilter = req.query.deviceBrandId && req.query.deviceBrandId !== 'all' ? Number(req.query.deviceBrandId) : undefined;
  const allDevices = req.query.allDevices === 'true' || req.query.deviceBrandId === 'all';
  const multiDeviceOnly = req.query.multiDeviceOnly === 'true';

  // 1. Fetch all connected brands
  const connectedBrands = await prisma.brand.findMany({
    where: { whatsappSession: { status: 'connected' } },
    include: { whatsappSession: true },
    orderBy: { id: 'asc' },
  });

  // 2. Fetch livechat conversations for all connected brands in parallel
  const brandConversations = await Promise.all(
    connectedBrands.map(async (brand) => {
      const list = await getLivechatConversationsForBrand(brand.id);
      // Exclude own device number and official WhatsApp system announcements
      const valid = list.filter((c) => !c.isOwn && c.remoteJid !== '0@s.whatsapp.net');
      return { brand, conversations: valid };
    })
  );

  // 3. Build global cross-device map indexed by normalized phone or JID
  const phoneDevicesMap = new Map<string, ContactDevice[]>();
  for (const { brand, conversations } of brandConversations) {
    for (const conv of conversations) {
      const norm = normalizePhoneIdentifier(conv.phone) || normalizePhoneIdentifier(conv.remoteJid) || conv.remoteJid || '';
      if (!norm) continue;

      const deviceItem: ContactDevice = {
        brandId: brand.id,
        brandName: brand.name,
        brandCode: brand.code,
        devicePhone: brand.whatsappSession?.phoneNumber || brand.phone || null,
        sessionName: brand.whatsappSession?.sessionName || `brand_${brand.id}`,
        deviceStatus: 'connected',
        prospectId: conv.id,
        remoteJid: conv.remoteJid,
        messageCount: conv.messageCount,
        lastActiveAt: conv.messages[0]?.timestamp
          ? new Date(conv.messages[0].timestamp * 1000).toISOString()
          : conv.updatedAt.toISOString(),
        isCurrentBrand: conv.brandId === brandId,
      };

      if (!phoneDevicesMap.has(norm)) {
        phoneDevicesMap.set(norm, []);
      }
      const list = phoneDevicesMap.get(norm)!;
      if (!list.some((d) => d.brandId === brand.id)) {
        list.push(deviceItem);
      }
    }
  }

  // 4. Select base conversation pool
  type ConvItem = typeof brandConversations[0]['conversations'][0];
  let baseConversations: ConvItem[] = [];

  if (deviceFilter) {
    const target = brandConversations.find((bc) => bc.brand.id === deviceFilter);
    baseConversations = target ? target.conversations : [];
  } else if (allDevices) {
    // Merge conversations across all devices by normalized phone/JID
    const groupedAll = new Map<string, ConvItem[]>();
    for (const { conversations } of brandConversations) {
      for (const conv of conversations) {
        const key = normalizePhoneIdentifier(conv.phone) || normalizePhoneIdentifier(conv.remoteJid) || conv.remoteJid || `id:${conv.id}`;
        groupedAll.set(key, [...(groupedAll.get(key) ?? []), conv]);
      }
    }
    baseConversations = [...groupedAll.values()].map((group) => chooseCanonicalProspect(group) as ConvItem);
  } else {
    // Current brand's livechat conversations
    const target = brandConversations.find((bc) => bc.brand.id === brandId);
    baseConversations = target ? target.conversations : [];
  }

  // 5. Map each conversation to contact response format with full device tags
  let data = baseConversations.map((conv) => {
    const norm = normalizePhoneIdentifier(conv.phone) || normalizePhoneIdentifier(conv.remoteJid) || conv.remoteJid || '';
    const devices = (norm ? phoneDevicesMap.get(norm) : null) ?? [
      {
        brandId: conv.brandId,
        brandName: conv.brand?.name || `Brand ${conv.brandId}`,
        brandCode: conv.brand?.code || '',
        devicePhone: conv.session?.phoneNumber || conv.brand?.phone || null,
        sessionName: conv.session?.sessionName || `brand_${conv.brandId}`,
        deviceStatus: 'connected' as const,
        prospectId: conv.id,
        remoteJid: conv.remoteJid,
        messageCount: conv.messageCount,
        lastActiveAt: conv.messages[0]?.timestamp
          ? new Date(conv.messages[0].timestamp * 1000).toISOString()
          : conv.updatedAt.toISOString(),
        isCurrentBrand: conv.brandId === brandId,
      },
    ];

    const isMultiDevice = devices.length > 1;
    const primaryDevice = devices.find((d) => d.brandId === brandId) || devices[0] || null;

    return {
      id: conv.id,
      brandId: conv.brandId,
      name: conv.name,
      phone: conv.phone,
      city: conv.city ?? null,
      photoUrl: conv.photoUrl ?? null,
      leadSource: conv.leadSource,
      status: conv.status,
      remoteJid: conv.remoteJid,
      updatedAt: conv.updatedAt,
      createdAt: conv.createdAt,
      user: conv.user,
      package: conv.package,
      messages: conv.messages,
      messageCount: conv.messageCount,
      duplicateIds: conv.duplicateIds,
      devices,
      isMultiDevice,
      deviceCount: devices.length,
      primaryDevice,
    };
  });

  // 6. Apply multi-device filter if requested
  if (multiDeviceOnly) {
    data = data.filter((item) => item.isMultiDevice);
  }

  // 7. Apply search filter if requested
  if (search) {
    data = data.filter((contact) => {
      const deviceNames = contact.devices.map((d) => `${d.brandName} ${d.devicePhone ?? ''}`).join(' ');
      return `${contact.name} ${contact.phone ?? ''} ${contact.city ?? ''} ${deviceNames}`
        .toLowerCase()
        .includes(search);
    });
  }

  // 8. Sort by latest chat activity
  data.sort((a, b) => {
    const timeA = a.messages[0]?.timestamp ?? new Date(a.updatedAt).getTime() / 1000;
    const timeB = b.messages[0]?.timestamp ?? new Date(b.updatedAt).getTime() / 1000;
    return timeB - timeA;
  });

  res.json({ success: true, data });
}));

// POST /api/v1/contacts - Manually register contact to connected WhatsApp device
contactsRouter.post('/', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const input = contactInputSchema.parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);
  const phone = normalizePhone(input.phone);
  if (phone.length < 8) throw new HttpError(422, 'Nomor WhatsApp tidak valid.');

  // Check if brand has WhatsApp device session
  const brand = await prisma.brand.findUniqueOrThrow({
    where: { id: brandId },
    include: { whatsappSession: true },
  });

  const existing = await prisma.prospect.findFirst({
    where: { brandId, phone: { in: phoneAliases(phone) } },
    select: { id: true },
  });
  if (existing) throw new HttpError(409, 'Kontak dengan nomor WhatsApp tersebut sudah tersedia.');

  const contact = await prisma.prospect.create({
    data: {
      brandId,
      name: input.name,
      phone,
      city: input.city || null,
      remoteJid: `${phone}@s.whatsapp.net`,
      leadSource: 'whatsapp', // marked as whatsapp lead so it syncs with connected device
    },
    include: { user: { select: { id: true, name: true } } },
  });

  await prisma.prospectLog.create({
    data: {
      prospectId: contact.id,
      userId: req.user!.id,
      actionType: 'contact_created',
      title: `Kontak riil didaftarkan untuk device ${brand.whatsappSession?.phoneNumber || brand.name} oleh ${req.user!.name}`,
    },
  });

  emitToBrand(brandId, 'contacts:synced', { imported: 1, contactId: contact.id });
  res.status(201).json({ success: true, data: contact });
}));
