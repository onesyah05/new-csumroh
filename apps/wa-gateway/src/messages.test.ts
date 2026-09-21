import { describe, expect, it } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import { addLidMappings, normalizePhone, toGatewayContact, toGatewayMessage } from './messages.js';

describe('WhatsApp history normalization', () => {
  it('normalizes Indonesian phone variants to one identifier', () => {
    expect(normalizePhone('08123456789')).toBe('628123456789');
    expect(normalizePhone('628123456789@s.whatsapp.net')).toBe('628123456789');
    expect(normalizePhone('123456@lid')).toBe('');
  });

  it('resolves a LID history message through Baileys mappings', () => {
    const mappings = new Map<string, string>();
    addLidMappings(mappings, [{ lid: '123@lid', pn: '628123456789@s.whatsapp.net' }]);
    const message = {
      key: { id: 'message-1', remoteJid: '123@lid', fromMe: false },
      message: { conversation: 'Assalamualaikum' },
      messageTimestamp: 1_700_000_000,
      pushName: 'Ibu Aisyah',
    } as WAMessage;

    expect(toGatewayMessage(7, message, mappings)).toMatchObject({
      brandId: 7,
      messageId: 'message-1',
      remoteJid: '123@lid',
      phone: '628123456789',
      text: 'Assalamualaikum',
      isFromMe: false,
    });
  });

  it('keeps outgoing historical messages as messages from the brand', () => {
    const message = {
      key: { id: 'message-2', remoteJid: '628123456789@s.whatsapp.net', fromMe: true },
      message: { imageMessage: {} },
      messageTimestamp: 1_700_000_100,
    } as WAMessage;

    expect(toGatewayMessage(7, message, new Map())).toMatchObject({
      phone: '628123456789',
      text: '[Gambar]',
      isFromMe: true,
    });
  });

  it('normalizes a WhatsApp contact into an inbox contact', () => {
    const mappings = new Map([['123@lid', '628123456789@s.whatsapp.net']]);
    expect(toGatewayContact(7, { id: '123@lid', name: 'Ibu Aisyah' }, mappings)).toEqual({
      brandId: 7,
      remoteJid: '123@lid',
      phone: '628123456789',
      name: 'Ibu Aisyah',
    });
  });
});
