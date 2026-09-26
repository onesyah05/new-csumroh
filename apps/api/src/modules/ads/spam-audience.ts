import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { decryptMetaToken } from '../capi/meta-token.js';
import { normalizePhone, sha256 } from '../capi/capi.payload.js';

/**
 * Audiens pengecualian "nomor spam" per brand (Customer List di ad account brand). Nomor di-hash SHA-256 sebelum
 * dikirim sesuai ketentuan Meta. Butuh token dengan izin ads_management dan Ketentuan Custom Audience yang sudah
 * disetujui di ad account.
 */
type Brand = { id: number; metaAdAccountId: string | null; metaAccessToken: string | null; metaSpamAudienceId: string | null };
type MetaError = { code?: number; error_subcode?: number; message?: string };

const AUDIENCE_NAME = 'CRM - Nomor spam (kecualikan)';
const BATCH = 10_000;

export class SpamAudienceError extends Error {}

function explain(error: MetaError | undefined) {
  const message = error?.message ?? '';
  if (error?.code === 190) return 'Access token Meta kedaluwarsa atau tidak valid.';
  if (/terms|ketentuan|tos/i.test(message)) return 'Setujui Ketentuan Custom Audience di Ads Manager (Audiens → Buat audiens khusus) terlebih dulu.';
  if (error?.code === 200 || error?.code === 10 || /permission|ads_management/i.test(message)) return 'Token belum punya izin ads_management untuk ad account ini.';
  return message ? `Meta: ${message}` : 'Permintaan ke Meta gagal.';
}

async function graph(token: string, path: string, init: { method: 'POST' | 'DELETE'; body: Record<string, string> }) {
  const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; error?: MetaError; num_received?: number };
  if (!response.ok || body.error) throw new SpamAudienceError(explain(body.error));
  return body;
}

function assertConfigured(brand: Brand): asserts brand is Brand & { metaAdAccountId: string; metaAccessToken: string } {
  if (!brand.metaAdAccountId || !brand.metaAccessToken) throw new SpamAudienceError('Isi Ad Account ID dan access token Meta brand terlebih dulu.');
}

/** Membuat audiens bila belum ada; ID disimpan di brand. */
async function ensureAudience(brand: Brand, token: string) {
  if (brand.metaSpamAudienceId) return brand.metaSpamAudienceId;
  const created = await graph(token, `act_${encodeURIComponent(brand.metaAdAccountId!)}/customaudiences`, {
    method: 'POST',
    body: {
      name: AUDIENCE_NAME,
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
      description: 'Nomor WhatsApp yang ditandai spam di CRM. Gunakan sebagai pengecualian di set iklan.',
    },
  });
  if (!created.id) throw new SpamAudienceError('Meta tidak mengembalikan ID audiens.');
  await prisma.brand.update({ where: { id: brand.id }, data: { metaSpamAudienceId: created.id } });
  return created.id;
}

export const hashPhones = (phones: string[]) => [...new Set(phones.map((p) => p.replace(/\D/g, '')).filter((p) => p.length >= 8).map((p) => sha256(normalizePhone(p))))];

async function send(audienceId: string, token: string, hashes: string[], method: 'POST' | 'DELETE') {
  let received = 0;
  for (let i = 0; i < hashes.length; i += BATCH) {
    const payload = JSON.stringify({ schema: ['PHONE'], data: hashes.slice(i, i + BATCH).map((h) => [h]) });
    const result = await graph(token, `${audienceId}/users`, { method, body: { payload } });
    received += result.num_received ?? 0;
  }
  return received;
}

/** Unggah seluruh nomor spam brand (Meta mengabaikan duplikat). */
export async function syncSpamAudience(brandId: number) {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId }, select: { id: true, metaAdAccountId: true, metaAccessToken: true, metaSpamAudienceId: true } });
  assertConfigured(brand);
  const token = decryptMetaToken(brand.metaAccessToken);
  const audienceId = await ensureAudience(brand, token);
  const rows = await prisma.prospect.findMany({ where: { brandId, spamAt: { not: null }, phone: { not: null } }, select: { phone: true } });
  const hashes = hashPhones(rows.map((r) => r.phone!));
  const received = hashes.length ? await send(audienceId, token, hashes, 'POST') : 0;
  const syncedAt = new Date();
  await prisma.brand.update({ where: { id: brandId }, data: { metaSpamSyncedAt: syncedAt } });
  return { audienceId, phones: hashes.length, received, syncedAt };
}

/** Tambah/hapus satu nomor saat CS menandai (atau membatalkan) spam; hanya bila audiens sudah pernah dibuat. */
export async function updateSpamAudienceMember(brandId: number, phone: string | null, spam: boolean) {
  if (!phone) return;
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, metaAdAccountId: true, metaAccessToken: true, metaSpamAudienceId: true } });
  if (!brand?.metaSpamAudienceId || !brand.metaAccessToken || !brand.metaAdAccountId) return;
  const hashes = hashPhones([phone]);
  if (!hashes.length) return;
  await send(brand.metaSpamAudienceId, decryptMetaToken(brand.metaAccessToken), hashes, spam ? 'POST' : 'DELETE');
}
