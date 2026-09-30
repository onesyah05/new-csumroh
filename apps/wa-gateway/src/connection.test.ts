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
  const key = { remoteJid: '62811@s.whatsapp.net', id: 'PROTO1', fromMe: false };
  it('tarik pesan merujuk ID pesan asli', () => {
    const message = { key, message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { id: 'ORIG1' } } } } as unknown as WAMessage;
    expect(toMessageChange(message)).toEqual({ kind: 'revoked', messageId: 'ORIG1' });
  });
  it('edit membawa teks baru', () => {
    const message = { key, message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, key: { id: 'ORIG2' }, editedMessage: { conversation: 'jadi 3 orang' } } } } as unknown as WAMessage;
    expect(toMessageChange(message)).toEqual({ kind: 'edited', messageId: 'ORIG2', text: 'jadi 3 orang' });
  });
  it('pesan biasa bukan perubahan', () => {
    expect(toMessageChange({ key, message: { conversation: 'halo' } } as unknown as WAMessage)).toBeNull();
  });
});
