import { DisconnectReason, proto, type WAMessage } from '@whiskeysockets/baileys';
import { describe, expect, it } from 'vitest';
import { classifyDisconnect, reconnectDelayMs } from './connection.js';
import { toMessageChange } from './messages.js';

describe('Putus-sambung WhatsApp', () => {
  it('putus permanen tidak disambung ulang; kredensial dihapus hanya bila perangkat dikeluarkan', () => {
    expect(classifyDisconnect(DisconnectReason.loggedOut)).toEqual({ kind: 'logged_out', permanent: true, clearCredentials: true });
    expect(classifyDisconnect(DisconnectReason.connectionReplaced)).toMatchObject({ kind: 'replaced', permanent: true, clearCredentials: false });
    expect(classifyDisconnect(DisconnectReason.forbidden)).toMatchObject({ kind: 'forbidden', permanent: true });
    expect(classifyDisconnect(DisconnectReason.connectionLost)).toMatchObject({ kind: 'connection_lost', permanent: false });
    expect(classifyDisconnect(undefined)).toMatchObject({ kind: 'connection_lost', permanent: false });
    expect(classifyDisconnect(DisconnectReason.restartRequired)).toMatchObject({ kind: 'restart', permanent: false });
  });

  it('jeda sambung ulang berlipat sampai 5 menit', () => {
    expect([0, 1, 2, 3].map(reconnectDelayMs)).toEqual([2_500, 5_000, 10_000, 20_000]);
    expect(reconnectDelayMs(20)).toBe(300_000);
  });
});

describe('Pesan ditarik / diedit pengirim', () => {
  const key = { remoteJid: '6281100001111@s.whatsapp.net', id: 'PROTO1', fromMe: false };
  it('tarik pesan merujuk ID pesan asli', () => {
    const message = { key, message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { id: 'ORIG1' } } } } as unknown as WAMessage;
    expect(toMessageChange(message)).toEqual({ kind: 'revoked', messageId: 'ORIG1', fromMe: false, chatJids: ['6281100001111@s.whatsapp.net'], phone: '6281100001111' });
  });
  it('edit membawa teks baru', () => {
    const message = { key, message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, key: { id: 'ORIG2' }, editedMessage: { conversation: 'jadi 3 orang' } } } } as unknown as WAMessage;
    expect(toMessageChange(message)).toEqual({ kind: 'edited', messageId: 'ORIG2', text: 'jadi 3 orang', fromMe: false, chatJids: ['6281100001111@s.whatsapp.net'], phone: '6281100001111' });
  });
  it('identitas pengirim diambil dari pesan pembawa, bukan dari isi protocolMessage', () => {
    const lidKey = { remoteJid: '1234@lid', id: 'PROTO2', fromMe: false };
    const message = { key: lidKey, message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { id: 'CS1', remoteJid: '6289900002222@s.whatsapp.net', fromMe: true } } } } as unknown as WAMessage;
    expect(toMessageChange(message, new Map([['1234@lid', '6281100001111@s.whatsapp.net']]))).toEqual({ kind: 'revoked', messageId: 'CS1', fromMe: false, chatJids: ['1234@lid', '6281100001111@s.whatsapp.net'], phone: '6281100001111' });
  });
  it('pesan biasa bukan perubahan', () => {
    expect(toMessageChange({ key, message: { conversation: 'halo' } } as unknown as WAMessage)).toBeNull();
  });
});
