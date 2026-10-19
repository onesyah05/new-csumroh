import {
  BUDGET_OPTIONS,
  TARGET_SEASONS,
  isQualificationComplete,
  parseTargetMonth,
  primaryRoomOf,
  sosmedLeadSource,
  type NewChatInput,
  type SessionUser,
} from '@csumroh/shared-types';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http.js';
import { activeDevicePhone } from './device-scope.js';
import { gatewayFailure, normalizePhoneIdentifier } from './outbound.js';

const phoneVariants = (phone: string) => [...new Set([phone, `+${phone}`, phone.startsWith('62') ? `0${phone.slice(2)}` : phone])];

/** Nomor yang belum pernah chat harus terdaftar di WhatsApp; jangan membuka chat ke nomor mati. */
async function assertOnWhatsapp(brandId: number, phone: string) {
  const response = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/check-number`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({ phone }),
  }).catch(() => null);
  if (!response?.ok) throw await gatewayFailure(brandId, response, 'Nomor belum bisa dicek di WhatsApp. Coba lagi.');
  const result = await response.json() as { data?: { exists?: boolean } };
  if (!result.data?.exists) throw new HttpError(422, 'Nomor ini tidak terdaftar di WhatsApp. Periksa kembali nomornya.');
}

function qualificationData(input: NewChatInput) {
  const targetMonth = input.targetMonth?.trim() || null;
  const budgetRange = input.budgetRange?.trim() || null;
  if (targetMonth) {
    const parsed = parseTargetMonth(targetMonth);
    if (parsed.key === null || (parsed.season && !(TARGET_SEASONS as readonly string[]).includes(parsed.season))) {
      throw new HttpError(422, 'Bulan keberangkatan harus dipilih dari daftar bulan.');
    }
  }
  if (budgetRange && !BUDGET_OPTIONS.some((option) => option.value === budgetRange)) throw new HttpError(422, 'Budget harus dipilih dari daftar.');
  const pax = { paxQuad: input.paxQuad ?? 0, paxTriple: input.paxTriple ?? 0, paxDouble: input.paxDouble ?? 0, paxInfant: input.paxInfant ?? 0 };
  const data = { targetMonth, budgetRange, ...pax, roomPreference: primaryRoomOf(pax) };
  return { data, complete: isQualificationComplete({ targetMonth, budgetRange, ...pax }) };
}

/**
 * Chat baru ke nomor yang diberikan tim sosmed. Pembuat otomatis menjadi PIC (tanpa round robin). Tidak ada pesan yang
 * dikirim di sini: percakapan kosong dibuka di Inbox dan CS mengetik pesan pertamanya sendiri.
 */
export async function startNewChat(user: SessionUser, brandId: number, input: NewChatInput) {
  const phone = normalizePhoneIdentifier(input.phone);
  if (phone.length < 8 || phone.length > 15) throw new HttpError(422, 'Nomor WhatsApp tidak valid.');
  const qualification = qualificationData(input);

  const devicePhone = await activeDevicePhone(brandId);
  if (!devicePhone) throw new HttpError(409, 'WhatsApp brand belum terhubung. Sambungkan dulu di pengaturan WhatsApp.');

  const remoteJid = `${phone}@s.whatsapp.net`;
  const existing = await prisma.prospect.findFirst({
    where: { brandId, devicePhone, OR: [{ phone: { in: phoneVariants(phone) } }, { remoteJid }] },
    select: { id: true, name: true, userId: true, user: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });

  if (existing) {
    const isAdmin = user.role === 'superadmin' || user.role === 'admin';
    if (existing.userId && existing.userId !== user.id && !isAdmin) {
      throw new HttpError(409, `Nomor ini sudah ditangani ${existing.user?.name ?? 'CS lain'}.`, {
        code: 'already_handled', prospectId: existing.id, prospectName: existing.name, picName: existing.user?.name ?? null,
      });
    }
    return { prospectId: existing.id, created: false };
  }

  await assertOnWhatsapp(brandId, phone);

  const prospect = await prisma.$transaction(async (tx) => {
    const created = await tx.prospect.create({
      data: {
        brandId,
        userId: user.id,
        name: input.name || `+${phone}`,
        phone,
        remoteJid,
        devicePhone,
        leadSource: sosmedLeadSource(input.source),
        notes: input.notes || null,
        ...qualification.data,
        ...(qualification.complete ? { status: 'qualified' as const, qualifiedAt: new Date() } : {}),
      },
    });
    await tx.prospectLog.create({
      data: { prospectId: created.id, userId: user.id, actionType: 'prospect_created', title: `Chat baru dimulai oleh ${user.name}`, description: `Sumber: ${input.source}` },
    });
    return created;
  });

  return { prospectId: prospect.id, created: true };
}
