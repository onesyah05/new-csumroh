import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { appendIncomingMessage } from './messageCache';

const JID = '62899@s.whatsapp.net';
const existing = (id: number, brandId: number, prospectId: number) => ({ id, brandId, prospectId, remoteJid: JID, timestamp: id });

function setup() {
  const client = new QueryClient();
  // Jamaah yang sama chat ke dua brand: prospek berbeda, remoteJid sama.
  client.setQueryData(['messages', 100, 1], [existing(1, 1, 100)]);
  client.setQueryData(['messages', 200, 2], [existing(2, 2, 200)]);
  return client;
}

describe('Pesan masuk realtime ke cache chat terbuka', () => {
  it('pesan brand 2 hanya masuk ke chat brand 2, tidak ke thread brand 1 yang remoteJid-nya sama', () => {
    const client = setup();
    appendIncomingMessage(client, { id: 3, brandId: 2, prospectId: 200, remoteJid: JID, timestamp: 3 });
    expect(client.getQueryData<any[]>(['messages', 200, 2])!.map((m) => m.id)).toEqual([2, 3]);
    expect(client.getQueryData<any[]>(['messages', 100, 1])!.map((m) => m.id)).toEqual([1]);
  });

  it('pesan brand 1 tidak masuk ke thread brand 2', () => {
    const client = setup();
    appendIncomingMessage(client, { id: 4, brandId: 1, prospectId: 100, remoteJid: JID, timestamp: 4 });
    expect(client.getQueryData<any[]>(['messages', 100, 1])!.map((m) => m.id)).toEqual([1, 4]);
    expect(client.getQueryData<any[]>(['messages', 200, 2])!.map((m) => m.id)).toEqual([2]);
  });

  it('tidak menggandakan pesan yang sudah ada dan mengabaikan percakapan lain', () => {
    const client = setup();
    appendIncomingMessage(client, { id: 1, brandId: 1, prospectId: 100, remoteJid: JID, timestamp: 1 });
    appendIncomingMessage(client, { id: 5, brandId: 1, prospectId: 999, remoteJid: '62000@s.whatsapp.net', timestamp: 5 });
    expect(client.getQueryData<any[]>(['messages', 100, 1])!.map((m) => m.id)).toEqual([1]);
  });

  it('event tanpa brandId tidak masuk cache mana pun (tidak bisa dipastikan brand-nya)', () => {
    const client = setup();
    appendIncomingMessage(client, { id: 6, prospectId: 100, remoteJid: JID, timestamp: 6 } as any);
    expect(client.getQueryData<any[]>(['messages', 100, 1])!.map((m) => m.id)).toEqual([1]);
    expect(client.getQueryData<any[]>(['messages', 200, 2])!.map((m) => m.id)).toEqual([2]);
  });
});
