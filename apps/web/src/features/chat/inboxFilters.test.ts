import { describe, expect, it } from 'vitest';
import { businessDateKey } from '@csumroh/shared-types';
import { getInboxQueue, visibleInboxFilters, type InboxConversation, type InboxWorkFilter } from './inboxFilters';

const incoming = { isFromMe: false, messageText: 'Tanya jadwal umroh', timestamp: 20 };
const outgoing = { isFromMe: true, messageText: 'Rincian paket', timestamp: 30 };
const defaults = { work: 'all' as const, owner: 'all', userId: 7, search: '', today: '2026-09-23' };
const contact = (id: number, patch: Partial<InboxConversation> = {}): InboxConversation => ({
  id, name: `Jamaah ${id}`, status: 'contact', userId: 7, messages: [incoming], ...patch,
});

describe('antrean kerja CS inbox', () => {
  it('pesan masuk tetap perlu dibalas setelah dibaca; balasan CS mengeluarkannya dari antrean', () => {
    const read = { ...contact(1), unreadCount: 0 };
    const unread = { ...contact(2), unreadCount: 3 };
    const answered = contact(3, { messages: [outgoing] });
    const list = [read, unread, answered, contact(4, { messages: [] })];
    expect(getInboxQueue(list, { ...defaults, work: 'needs_reply' }).conversations.map((p) => p.id)).toEqual([1, 2]);
    read.messages = [outgoing];
    expect(getInboxQueue(list, { ...defaults, work: 'needs_reply' }).conversations.map((p) => p.id)).toEqual([2]);
  });

  it('menggabungkan pekerjaan, PIC saya, dan pencarian; jumlah chip memakai lingkup yang sama', () => {
    const list = [contact(1, { name: 'Ahmad' }), contact(2, { name: 'Ahmad', userId: 8 }), contact(3, { name: 'Ahmad', messages: [outgoing] }), contact(4)];
    const result = getInboxQueue(list, { ...defaults, work: 'needs_reply', owner: 'mine', search: ' AHMAD ' });
    expect(result.conversations.map((p) => p.id)).toEqual([1]);
    expect(result.counts).toMatchObject({ all: 2, needs_reply: 1, followup: 0, 'stage:contact': 2 });
  });

  it('memisahkan penugasan CS tanpa menganggap admin tanpa id sebagai PIC', () => {
    const list = [contact(1), contact(2, { userId: 8 }), contact(3, { userId: null })];
    expect(getInboxQueue(list, { ...defaults, owner: 'user:8' }).conversations.map((p) => p.id)).toEqual([2]);
    expect(getInboxQueue(list, { ...defaults, owner: 'mine', userId: undefined }).conversations).toEqual([]);
  });

  it('antrean belum ada PIC hanya memuat prospek terbuka tanpa penanggung jawab', () => {
    const list = [contact(1, { userId: null }), contact(2), ...['deal', 'closed_won', 'lose', 'closed_lost'].map((status, i) => contact(i + 3, { userId: null, status }))];
    expect(getInboxQueue(list, { ...defaults, owner: 'unassigned' }).conversations.map((p) => p.id)).toEqual([1]);
  });

  it('grup, nomor sendiri, dan akun WhatsApp resmi tetap ada di Semua, bukan antrean jamaah', () => {
    const list = [contact(1), contact(2, { isGroup: true }), contact(3, { remoteJid: '123@g.us' }), contact(4, { isOwn: true }), contact(5, { remoteJid: '0@s.whatsapp.net' })];
    expect(getInboxQueue(list, defaults).conversations).toHaveLength(5);
    expect(getInboxQueue(list, { ...defaults, work: 'needs_reply' }).conversations.map((p) => p.id)).toEqual([1]);
  });

  it('follow-up memuat hari ini dan yang terlambat, termasuk jadwal layanan setelah Deal', () => {
    const list = [contact(1, { nextFollowupDate: '2026-09-23T00:00:00.000Z' }), contact(2, { nextFollowupDate: '2026-09-20', status: 'deal' }), contact(3, { nextFollowupDate: '2026-09-24' }), contact(4)];
    expect(getInboxQueue(list, { ...defaults, work: 'followup' }).conversations.map((p) => p.id)).toEqual([2, 1]);
    expect(list.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });

  it('mengikuti pergantian hari WIB untuk sesi CS yang tetap terbuka', () => {
    const list = [contact(1, { nextFollowupDate: '2026-09-24' })];
    expect(getInboxQueue(list, { ...defaults, work: 'followup', today: businessDateKey(new Date('2026-09-23T16:59:59Z')) }).counts.followup).toBe(0);
    expect(getInboxQueue(list, { ...defaults, work: 'followup', today: businessDateKey(new Date('2026-09-23T17:00:00Z')) }).counts.followup).toBe(1);
  });

  it('chat spam tetap di Semua, tetapi tidak masuk antrean perlu dibalas, follow-up, atau belum ada PIC', () => {
    const spam = contact(1, { userId: null, spamAt: '2026-09-23T01:00:00.000Z', nextFollowupDate: '2026-09-20' });
    const normal = contact(2, { userId: null, nextFollowupDate: '2026-09-20' });
    const list = [spam, normal];
    expect(getInboxQueue(list, defaults).conversations.map((p) => p.id)).toEqual([1, 2]);
    expect(getInboxQueue(list, { ...defaults, work: 'needs_reply' }).conversations.map((p) => p.id)).toEqual([2]);
    expect(getInboxQueue(list, { ...defaults, work: 'followup' }).conversations.map((p) => p.id)).toEqual([2]);
    expect(getInboxQueue(list, { ...defaults, owner: 'unassigned' }).conversations.map((p) => p.id)).toEqual([2]);
  });
});

describe('filter tahap prospek (satu per tahap pipeline, hanya yang ada isinya)', () => {
  const list = [
    contact(1, { status: 'qualified' }),
    contact(2, { status: 'deal' }),
    contact(3, { status: 'closed_won' }),
    contact(4, { status: 'lose' }),
    contact(5, { status: 'closed_lost' }),
    contact(6),
    contact(7, { status: 'qualified', spamAt: '2026-09-23T01:00:00.000Z' }),
    contact(8, { status: 'deal', isGroup: true }),
    contact(9, { status: 'identifying' }),
  ];
  const ids = (work: InboxWorkFilter, rows = list, owner = 'all') => getInboxQueue(rows, { ...defaults, work, owner }).conversations.map((p) => p.id);

  it('menyaring per tahap; status lama dipetakan ke tahap kanonik (Deal, Batal, Terhubung)', () => {
    expect(ids('stage:qualified')).toEqual([1]);
    expect(ids('stage:deal')).toEqual([2, 3]);
    expect(ids('stage:lose')).toEqual([4, 5]);
    expect(ids('stage:contact')).toEqual([6, 9]);
    expect(getInboxQueue(list, defaults).counts).toMatchObject({ all: 9, 'stage:qualified': 1, 'stage:deal': 2, 'stage:lose': 2, 'stage:contact': 2, 'stage:offer': 0 });
  });

  it('chat spam dan grup tidak masuk antrean tahap, dan filter tahap ikut PIC + pencarian', () => {
    expect(ids('stage:qualified')).not.toContain(7);
    expect(ids('stage:deal')).not.toContain(8);
    const mine = [contact(1, { status: 'deal', userId: 7 }), contact(2, { status: 'deal', userId: 8 })];
    expect(ids('stage:deal', mine, 'mine')).toEqual([1]);
  });

  it('chip tahap kosong disembunyikan; antrean kerja selalu tampil; pilihan aktif tetap terlihat', () => {
    const { counts } = getInboxQueue(list, defaults);
    const shown = (active: InboxWorkFilter) => visibleInboxFilters(counts, active).map((f) => f.id);
    expect(shown('all')).toEqual(['all', 'needs_reply', 'followup', 'stage:contact', 'stage:qualified', 'stage:deal', 'stage:lose']);
    expect(shown('stage:offer')).toContain('stage:offer');
    expect(visibleInboxFilters({ all: 0, needs_reply: 0, followup: 0 }, 'all').map((f) => f.id)).toEqual(['all', 'needs_reply', 'followup']);
  });
});
