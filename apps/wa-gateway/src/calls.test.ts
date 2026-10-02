import { describe, expect, it } from 'vitest';
import type { WACallEvent } from '@whiskeysockets/baileys';
import { toGatewayCall } from './messages.js';

const base: WACallEvent = { chatId: '6281234567890@s.whatsapp.net', from: '6281234567890@s.whatsapp.net', id: 'C1', date: new Date(1_790_000_000_000), offline: false, status: 'offer', isVideo: true };

describe('Panggilan WhatsApp ke CRM', () => {
  it('panggilan jamaah diteruskan dengan nomor, jenis, dan waktu', () => {
    expect(toGatewayCall(3, base, new Map())).toEqual({
      brandId: 3, callId: 'C1', remoteJid: '6281234567890@s.whatsapp.net', phone: '6281234567890', isVideo: true, status: 'offer', timestamp: 1_790_000_000, offline: false,
    });
  });

  it('penelepon @lid dipetakan ke nomornya', () => {
    const lid = { ...base, from: '999@lid', callerPn: undefined };
    expect(toGatewayCall(3, lid, new Map([['999@lid', '6289876543210@s.whatsapp.net']]))?.phone).toBe('6289876543210');
  });

  it('panggilan grup, status teknis, dan panggilan dari nomor brand sendiri diabaikan', () => {
    expect(toGatewayCall(3, { ...base, isGroup: true }, new Map())).toBeNull();
    expect(toGatewayCall(3, { ...base, status: 'relaylatency' }, new Map())).toBeNull();
    expect(toGatewayCall(3, base, new Map(), '6281234567890')).toBeNull();
  });
});
