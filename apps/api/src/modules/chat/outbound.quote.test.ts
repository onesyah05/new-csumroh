import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ quoted: null as null | Record<string, unknown> }));
vi.mock('../../db/prisma.js', () => ({ prisma: { chatMessage: { findFirst: async () => mocks.quoted } } }));

import { normalizePhoneIdentifier, resolveQuote } from './outbound.js';

const prospectB = { id: 2, name: 'Bu Ani', phone: '6281200002222', remoteJid: '6281200002222@s.whatsapp.net' };

beforeEach(() => { mocks.quoted = null; });

describe('Kutipan balasan', () => {
  it('pesan dari chat jamaah lain tidak ikut terkirim sebagai kutipan', async () => {
    mocks.quoted = { prospectId: 1, remoteJid: '6281100001111@s.whatsapp.net', phone: '6281100001111', messageText: 'Transfer ke BSI 111 a.n. Pak Budi', senderName: 'Pak Budi', isFromMe: false };
    expect(await resolveQuote(1, prospectB, { quotedMessageId: 'A1', quotedText: 'Transfer ke BSI 111 a.n. Pak Budi' })).toEqual({});
  });

  it('pesan di chat yang sama tetap dikutip', async () => {
    mocks.quoted = { prospectId: 2, remoteJid: prospectB.remoteJid, phone: prospectB.phone, messageText: 'Jadi 3 orang', senderName: 'Bu Ani', isFromMe: false };
    expect(await resolveQuote(1, prospectB, { quotedMessageId: 'B1' })).toEqual({ quotedMessageId: 'B1', quotedText: 'Jadi 3 orang', quotedSender: 'Bu Ani', isQuotedFromMe: false });
  });
});

describe('Nomor WhatsApp luar negeri', () => {
  it('nomor berawalan 8 dari JID tidak diubah menjadi nomor Indonesia', () => {
    expect(normalizePhoneIdentifier('85291234567@s.whatsapp.net')).toBe('85291234567');
    expect(normalizePhoneIdentifier('821012345678@s.whatsapp.net')).toBe('821012345678');
    expect(normalizePhoneIdentifier('6281234567890@s.whatsapp.net')).toBe('6281234567890');
    expect(normalizePhoneIdentifier('081234567890')).toBe('6281234567890');
  });
});
