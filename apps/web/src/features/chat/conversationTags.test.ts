import { describe, expect, it } from 'vitest';
import { conversationTags, conversationTrip } from './conversationTags';

const today = '2026-10-10';
const labels = (item: Parameters<typeof conversationTags>[0], custom?: Parameters<typeof conversationTags>[2]) =>
  conversationTags(item, today, custom).map((t) => t.label);

describe('conversationTags', () => {
  it('grup dan chat sendiri tidak punya tag', () => {
    expect(labels({ isGroup: true, status: 'new' })).toEqual([]);
    expect(labels({ isOwn: true, status: 'new' })).toEqual([]);
  });

  it('spam hanya menampilkan Spam', () => {
    expect(labels({ spamAt: '2026-10-01T00:00:00Z', status: 'new', userId: 1 })).toEqual(['Spam']);
  });

  it('urutan: perlu tindakan dulu, tahap kemudian', () => {
    expect(labels({ status: 'offer', nextFollowupDate: '2026-10-09', userId: null })).toEqual(['Telat', 'Tanpa PIC', 'Penawaran']);
  });

  it('bukti transfer menandai Verifikasi sebagai perlu tindakan', () => {
    expect(labels({ status: 'closing', paymentProofUrl: 'x', userId: 2 })).toEqual(['Verifikasi']);
    expect(conversationTags({ status: 'closing', paymentProofUrl: 'x', userId: 2 }, today)[0]?.tone).toBe('warn');
    expect(conversationTags({ status: 'closing', userId: 2 }, today)[0]?.tone).toBe('info');
  });

  it('deal menampilkan Lunas atau DP, tanpa Tanpa PIC', () => {
    expect(labels({ status: 'closed_won', paymentStatus: 'paid_full', userId: null })).toEqual(['Lunas']);
    expect(labels({ status: 'deal', paymentStatus: 'partial_dp', userId: 3 })).toEqual(['DP']);
  });

  it('batal tidak menampilkan follow-up', () => {
    expect(labels({ status: 'lose', nextFollowupDate: '2026-10-01', userId: 1 })).toEqual(['Batal']);
  });

  it('tujuan: nama paket terpilih mengalahkan bulan target', () => {
    expect(conversationTrip({ package: { name: 'Umroh Reguler Barokah 9 Hari' }, targetMonth: '2027-02' })).toEqual({ label: 'Reguler Barokah 9 Hari', title: 'Umroh Reguler Barokah 9 Hari' });
  });

  it('tujuan: bulan target dipendekkan, teks lama apa adanya, kosong = null', () => {
    expect(conversationTrip({ targetMonth: '2027-02 Ramadan' })).toEqual({ label: 'Feb 2027', title: 'Target berangkat Februari 2027 · Ramadan' });
    expect(conversationTrip({ targetMonth: 'Akhir tahun' })?.label).toBe('Akhir tahun');
    expect(conversationTrip({ targetMonth: '' })).toBeNull();
    expect(conversationTrip({ isGroup: true, targetMonth: '2027-02' })).toBeNull();
  });

  it('follow-up hari ini dan custom', () => {
    expect(labels({ status: 'qualified', nextFollowupDate: '2026-10-10', userId: 1 }, { text: 'Custom: harga siap', urgent: false })).toEqual(['Hari ini', 'Kualifikasi', 'Custom']);
  });
});
