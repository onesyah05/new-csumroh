import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScriptContext } from '../scripts/context.js';
import { ProviderError, setProviderForTests, type AiProvider, type ProviderRequest } from './provider.js';
import { promptMessages, suggestReplies } from './suggest.service.js';

const brand = { name: 'Hana Tours', ppiuNumber: 'PPIU 1', bankName: 'BSI', bankAccountNumber: '7001', bankAccountHolder: 'PT Hana' };
const pkg = {
  id: 3, name: 'Umroh Plus Turki', isActive: true, departureDate: new Date('2099-02-14'), departureInfo: null, duration: '12 hari',
  airline: 'Saudia', hotelMakkah: 'Hotel A', hotelMadinah: 'Hotel B', price: '35000000', dp: '5000000', priceQuad: null, priceTriple: null,
  priceDouble: null, priceInfant: null, quotaRemaining: 10, facilitiesIncluded: null, facilitiesExcluded: null, isPromo: false, promoDiscount: null, promoDeadline: null,
};
const prospectRow = {
  status: 'objection', name: 'Siti Aminah', city: 'Bekasi', targetMonth: null, budgetRange: null, paxQuad: 2, paxTriple: 0, paxDouble: 0, paxInfant: 0,
  nextFollowupDate: null, offerSentAt: null, dealValue: null, invoiceNumber: null, invoiceAmount: null, invoiceDueAt: null, paymentProofUrl: null,
};
const context = buildScriptContext({ csName: 'Fitri', brand, pkg, prospect: prospectRow, now: new Date('2026-10-13T03:00:00Z') });
const input = {
  csName: 'Fitri', brandName: 'Hana Tours', context,
  prospect: { name: 'Siti Aminah', status: 'objection', objectionCategory: 'price', objectionNotes: null },
  messages: [
    { isFromMe: true, messageType: 'conversation', messageText: 'Paketnya Umroh Plus Turki ya Bu.' },
    { isFromMe: false, messageType: 'conversation', messageText: 'Mahal juga ya kak, saya tanya suami dulu. WA suami 081234567890' },
  ],
  instruction: null,
};

const output = (templates: string[]) => ({
  intent: 'objection', objection: 'harga', coverage: 'partial', needs_internal_info: false,
  options: templates.map((template, i) => ({ approach: `Opsi ${i + 1}`, origin: 'adapted', template })),
});
function fakeProvider(...results: Array<unknown | Error>) {
  const requests: ProviderRequest[] = [];
  const provider: AiProvider = {
    generate: vi.fn(async (request: ProviderRequest) => {
      requests.push(request);
      const next = results.shift();
      if (next instanceof Error) throw next;
      return { json: next, model: 'claude-haiku-5-5', inputTokens: 100, outputTokens: 50 };
    }),
  };
  setProviderForTests(provider);
  return { provider, requests };
}

afterEach(() => setProviderForTests(null));

describe('promptMessages', () => {
  it('menyamarkan data pribadi dan mengganti media dengan label', () => {
    const lines = promptMessages([
      { isFromMe: false, messageType: 'imageMessage', messageText: null },
      { isFromMe: false, messageType: 'conversation', messageText: 'NIK saya 3201234567890001' },
      { isFromMe: true, messageType: 'conversation', messageText: '   ' },
    ]);
    expect(lines).toEqual([{ fromCs: false, text: '[gambar]' }, { fromCs: false, text: 'NIK saya [disamarkan]' }]);
  });
});

describe('suggestReplies', () => {
  it('mengisi token dari data paket dan memberi status pakai', async () => {
    const { requests } = fakeProvider(output(['Wajar Bu dibahas dengan Bapak. DP-nya {{dp_per_orang}} per orang. Boleh saya kirim rinciannya?']));
    const result = await suggestReplies(input);
    expect(result.source).toBe('ai');
    expect(result.detected).toMatchObject({ intent: 'objection', objection: 'harga', stageLabel: 'Keberatan' });
    expect(result.options[0]!.text).toContain('Rp5.000.000');
    expect(result.options[0]!.template).toContain('{{dp_per_orang}}');
    expect(result.options[0]!.status).toBe('ready');
    // Data pribadi di chat tidak ikut terkirim; nilai fakta paket juga tidak dikirim ke model.
    expect(requests[0]!.user).not.toContain('081234567890');
    expect(requests[0]!.user).not.toContain('5.000.000');
    expect(requests[0]!.user).toContain('Siti.');
    expect(requests[0]!.material).toContain('TGJP');
  });

  it('membuang opsi yang menulis fakta sendiri dan tetap menampilkan yang lolos', async () => {
    fakeProvider(output(['DP cukup Rp5.000.000 saja Bu', 'Boleh saya kirim rincian {{paket}} untuk dibahas dengan Bapak?']));
    const result = await suggestReplies(input);
    expect(result.source).toBe('ai');
    expect(result.options).toHaveLength(1);
    expect(result.options[0]!.text).toContain('Umroh Plus Turki');
  });

  it('mencoba ulang sekali dengan koreksi, lalu fallback ke script bank', async () => {
    const { requests } = fakeProvider(output(['Harganya 35 juta Bu']), output(['Berangkat 14 Februari 2099']));
    const result = await suggestReplies(input);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.user).toContain('ditolak karena');
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toBe('invalid_output');
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options.every((option) => option.origin === 'bank')).toBe(true);
  });

  it('fallback saat provider gagal, timeout, atau menolak', async () => {
    fakeProvider(new ProviderError('timeout', 'lambat'));
    expect((await suggestReplies(input)).fallbackReason).toBe('timeout');
    fakeProvider(new ProviderError('refusal', 'ditolak'));
    expect((await suggestReplies(input)).fallbackReason).toBe('refusal');
  });

  it('token kosong membuat opsi berstatus perlu data, bukan diisi tebakan', async () => {
    fakeProvider(output(['Budget {{budget}} per orang sudah cukup untuk {{paket}}, Bu?']));
    const result = await suggestReplies(input);
    expect(result.options[0]!.text).toContain('{{budget}}');
    expect(result.options[0]!.status).toBe('needs_context');
  });
});
