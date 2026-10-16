import { describe, expect, it, vi } from 'vitest';
import { buildEditMessage, editMessage, type EditSocket } from './edit.js';

const jid = '62811@s.whatsapp.net';
const own = '62822:12@s.whatsapp.net';
const quote = { messageId: 'ORIG1', text: 'Berapa harganya?', fromMe: false };

function fakeSocket(overrides: { user?: EditSocket['user']; sendMessage?: EditSocket['sendMessage']; relayMessage?: EditSocket['relayMessage'] } = {}) {
  const sendMessage = vi.fn(overrides.sendMessage ?? (async () => ({})));
  const relayMessage = vi.fn(overrides.relayMessage ?? (async () => ({})));
  return { user: 'user' in overrides ? overrides.user : { id: own }, sendMessage, relayMessage };
}

describe('Isi pesan edit', () => {
  it('tanpa kutipan: protocolMessage MESSAGE_EDIT berisi teks baru untuk pesan milik kita', () => {
    const message = buildEditMessage({ jid, messageId: 'WA1', text: 'Harga 28 juta' });
    expect(message.protocolMessage?.key).toEqual({ remoteJid: jid, id: 'WA1', fromMe: true });
    expect(message.protocolMessage?.editedMessage).toEqual({ conversation: 'Harga 28 juta' });
    expect(message.protocolMessage?.type).toBe(14);
  });

  it('dengan kutipan jamaah: konteks kutipan ikut di dalam isi yang diedit, pengirimnya jamaah', () => {
    const message = buildEditMessage({ jid, messageId: 'WA1', text: 'Harga 28 juta', ownJid: own, quote });
    const context = message.protocolMessage?.editedMessage?.extendedTextMessage?.contextInfo;
    expect(message.protocolMessage?.editedMessage?.extendedTextMessage?.text).toBe('Harga 28 juta');
    expect(context).toMatchObject({ stanzaId: 'ORIG1', participant: jid, quotedMessage: { conversation: 'Berapa harganya?' } });
  });

  it('kutipan ke pesan kita sendiri: pengirim kutipan adalah nomor brand (tanpa sufiks perangkat)', () => {
    const message = buildEditMessage({ jid, messageId: 'WA1', text: 'x', ownJid: own, quote: { ...quote, fromMe: true } });
    expect(message.protocolMessage?.editedMessage?.extendedTextMessage?.contextInfo?.participant).toBe('62822@s.whatsapp.net');
  });
});

describe('Mengedit pesan', () => {
  it('tanpa kutipan: jalur standar sendMessage dengan edit, relay tidak dipakai', async () => {
    const socket = fakeSocket();
    expect(await editMessage(socket, { jid, messageId: 'WA1', text: 'Harga 28 juta' })).toBe('standard');
    expect(socket.sendMessage).toHaveBeenCalledWith(jid, { text: 'Harga 28 juta', edit: { remoteJid: jid, id: 'WA1', fromMe: true } });
    expect(socket.relayMessage).not.toHaveBeenCalled();
  });

  it('dengan kutipan: relay dengan atribut edit=1 dan kutipan di dalam isi; sendMessage tidak dipakai', async () => {
    const socket = fakeSocket();
    expect(await editMessage(socket, { jid, messageId: 'WA1', text: 'Harga 28 juta', quote })).toBe('quoted');
    expect(socket.sendMessage).not.toHaveBeenCalled();
    const [relayJid, content, options] = socket.relayMessage.mock.calls[0]!;
    expect(relayJid).toBe(jid);
    expect(options.additionalAttributes).toEqual({ edit: '1' });
    expect(options.messageId).toBeTruthy();
    expect(content.protocolMessage.key).toMatchObject({ id: 'WA1', fromMe: true });
    expect(content.protocolMessage.editedMessage.extendedTextMessage.contextInfo.stanzaId).toBe('ORIG1');
  });

  it('relay gagal: jatuh ke jalur standar dan melaporkan penyebabnya (edit tetap terjadi)', async () => {
    const socket = fakeSocket({ relayMessage: async () => { throw new Error('relay gagal'); } });
    const onFallback = vi.fn();
    expect(await editMessage(socket, { jid, messageId: 'WA1', text: 'Harga 28 juta', quote }, onFallback)).toBe('standard');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(socket.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('kegagalan jalur standar diteruskan ke pemanggil (API menolak dan CRM tidak berubah)', async () => {
    const socket = fakeSocket({ sendMessage: async () => { throw new Error('ditolak WhatsApp'); } });
    await expect(editMessage(socket, { jid, messageId: 'WA1', text: 'x' })).rejects.toThrow('ditolak WhatsApp');
  });

  it('sesi belum punya identitas (user kosong): memakai jalur standar walau ada kutipan', async () => {
    const socket = fakeSocket({ user: null });
    expect(await editMessage(socket, { jid, messageId: 'WA1', text: 'x', quote })).toBe('standard');
    expect(socket.relayMessage).not.toHaveBeenCalled();
  });
});
