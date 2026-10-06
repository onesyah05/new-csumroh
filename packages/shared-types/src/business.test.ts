import { describe, expect, it } from 'vitest';
import { effectiveNotificationPreference, notificationCatalog, notificationTypesForRole } from './notifications.js';
import {
  PIC_TAKEOVER_AFTER_MINUTES,
  firstUnansweredAt,
  isOperationalTime,
  isTakeoverOpen,
  takeoverOpensAt,
  businessDateKey,
  canonicalStatus,
  calculateDealValue,
  canTransitionStatus,
  capiEventForStatus,
  dateOnlyKey,
  nextTgjpStep,
  objectionLabel,
  packageBookingValue,
  seatCountFor,
} from './business.js';

describe('critical business rules', () => {
  it('allows moving a prospect freely across the operational pipeline', () => {
    expect(canTransitionStatus('new', 'identifying')).toBe(true);
    expect(canTransitionStatus('new', 'closed_won')).toBe(true);
    expect(canTransitionStatus('followup', 'qualified')).toBe(true);
  });

  it('never moves a verified deal back into the pipeline; only cancellation', () => {
    expect(canTransitionStatus('closed_won', 'followup')).toBe(false);
    expect(canTransitionStatus('deal', 'offer')).toBe(false);
    expect(canTransitionStatus('deal', 'closing')).toBe(false);
    expect(canTransitionStatus('deal', 'lose')).toBe(true);
    expect(canTransitionStatus('deal', 'deal')).toBe(true);
  });

  it('shows objection categories as labels, never raw codes', () => {
    expect(objectionLabel('price')).toBe('Harga');
    expect(objectionLabel('facility_distance')).toBe('Fasilitas / jarak hotel');
    expect(objectionLabel(null)).toBe('Keberatan');
    expect(objectionLabel('catatan lama')).toBe('catatan lama');
  });

  it('maps legacy statuses onto canonical Kanban columns', () => {
    expect(canonicalStatus('closed_won')).toBe('deal');
    expect(canonicalStatus('offered')).toBe('offer');
    expect(canonicalStatus('nurture')).toBe('followup');
    expect(canonicalStatus('closing')).toBe('closing');
  });

  it('reads DATE columns and business dates consistently in WIB', () => {
    expect(dateOnlyKey(new Date('2026-09-23T00:00:00.000Z'))).toBe('2026-09-23');
    expect(dateOnlyKey('2026-09-23T00:00:00.000Z')).toBe('2026-09-23');
    expect(dateOnlyKey(String(new Date('2026-09-23T00:00:00.000Z')))).toBeNull();
    // 23:30 UTC on the 22nd is already the 23rd in Jakarta (UTC+7)
    expect(businessDateKey(new Date('2026-09-22T23:30:00.000Z'))).toBe('2026-09-23');
    expect(businessDateKey(new Date('2026-09-23T16:59:00.000Z'))).toBe('2026-09-23');
    expect(businessDateKey(new Date('2026-09-23T17:00:00.000Z'))).toBe('2026-09-24');
  });

  it('prices a booking from the catalog and counts seats without infants', () => {
    const pkg = { price: 'Rp 30.000.000', priceDouble: 'Rp 36.000.000', priceInfant: '8.000.000' };
    expect(packageBookingValue(pkg, { paxQuad: 2, paxDouble: 1, paxInfant: 1 })).toBe(104_000_000);
    expect(packageBookingValue({ price: '' }, { paxQuad: 2 })).toBe(0);
    expect(seatCountFor({ paxQuad: 2, paxDouble: 1 })).toBe(3);
    expect(seatCountFor({})).toBe(1);
  });

  it('calculates deal value from room prices and pax counts', () => {
    expect(calculateDealValue({ quad: 30_000_000, double: 36_000_000, infant: 8_000_000 }, { quad: 2, double: 1, infant: 1 })).toBe(104_000_000);
    expect(calculateDealValue({ quad: 30 }, { quad: -2 })).toBe(0);
  });

  it('advances TGJP in order', () => {
    expect(nextTgjpStep('terima')).toBe('gali');
    expect(nextTgjpStep('pastikan')).toBeNull();
  });

  it('maps conversion events', () => {
    expect(capiEventForStatus('new')).toBe('LeadSubmitted');
    expect(capiEventForStatus('contact')).toBe('LeadSubmitted');
    expect(capiEventForStatus('identifying')).toBeNull();
    expect(capiEventForStatus('offer')).toBe('AddToCart');
    expect(capiEventForStatus('closing')).toBe('InitiateCheckout');
    expect(capiEventForStatus('deal')).toBe('Purchase');
    expect(capiEventForStatus('followup')).toBeNull();
    expect(capiEventForStatus('lose')).toBeNull();
  });
});

describe('ambil alih PIC setelah 15 menit belum dibalas', () => {
  it('menghitung dari pesan jamaah pertama setelah balasan CS terakhir', () => {
    const messages = [
      { timestamp: 100, isFromMe: false },
      { timestamp: 200, isFromMe: true },
      { timestamp: 300, isFromMe: false },
      { timestamp: 900, isFromMe: false },
    ];
    expect(firstUnansweredAt(messages)).toBe(300);
    expect(firstUnansweredAt([...messages, { timestamp: 1000, isFromMe: true }])).toBeNull();
  });

  const wib = (iso: string) => new Date(`${iso}+07:00`).getTime();

  it('jam operasional: terbuka tepat 15 menit setelah pesan pertama yang belum dibalas', () => {
    const since = wib('2026-10-06T10:00:00') / 1000;
    expect(isTakeoverOpen(since, (since + 14 * 60) * 1000)).toBe(false);
    expect(isTakeoverOpen(since, (since + 15 * 60) * 1000)).toBe(true);
    expect(isTakeoverOpen(null)).toBe(false);
    expect(takeoverOpensAt(since, since * 1000)).toBe((since + PIC_TAKEOVER_AFTER_MINUTES * 60) * 1000);
  });

  it('di luar jam operasional (22.00–08.00 WIB) PIC tetap terkunci; terbuka lagi tepat 08.00', () => {
    // Chat 21.30: terbuka 21.45, terkunci mulai 22.00, terbuka lagi 08.00 besok.
    const evening = wib('2026-10-06T21:30:00') / 1000;
    expect(isTakeoverOpen(evening, wib('2026-10-06T21:50:00'))).toBe(true);
    expect(isTakeoverOpen(evening, wib('2026-10-06T22:00:00'))).toBe(false);
    expect(isTakeoverOpen(evening, wib('2026-10-07T07:59:00'))).toBe(false);
    expect(isTakeoverOpen(evening, wib('2026-10-07T08:00:00'))).toBe(true);
    expect(takeoverOpensAt(evening, wib('2026-10-06T23:00:00'))).toBe(wib('2026-10-07T08:00:00'));
    // Chat 21.55: 15 menit jatuh 22.10 (di luar jam) → terbuka tepat 08.00.
    expect(takeoverOpensAt(wib('2026-10-06T21:55:00') / 1000, wib('2026-10-06T21:56:00'))).toBe(wib('2026-10-07T08:00:00'));
    // Chat dini hari 03.00 → terbuka 08.00 hari yang sama.
    expect(takeoverOpensAt(wib('2026-10-07T03:00:00') / 1000, wib('2026-10-07T03:00:00'))).toBe(wib('2026-10-07T08:00:00'));
    // Chat 07.50 → 15 menit jatuh 08.05 (jam operasional).
    expect(takeoverOpensAt(wib('2026-10-07T07:50:00') / 1000, wib('2026-10-07T07:51:00'))).toBe(wib('2026-10-07T08:05:00'));
  });

  it('batas jam operasional: 08.00 masuk, 22.00 sudah di luar', () => {
    expect(isOperationalTime(wib('2026-10-06T07:59:59'))).toBe(false);
    expect(isOperationalTime(wib('2026-10-06T08:00:00'))).toBe(true);
    expect(isOperationalTime(wib('2026-10-06T21:59:59'))).toBe(true);
    expect(isOperationalTime(wib('2026-10-06T22:00:00'))).toBe(false);
  });
});

describe('katalog notifikasi', () => {
  it('tipe unik; preferensi default: toast untuk tindakan, tidak untuk info; mendesak terkunci', () => {
    const types = notificationCatalog.map((entry) => entry.type);
    expect(new Set(types).size).toBe(types.length);
    expect(effectiveNotificationPreference('message.inbound')).toEqual({ toast: false, sound: false, muted: false, locked: false });
    expect(effectiveNotificationPreference('lead.assigned')).toEqual({ toast: true, sound: false, muted: false, locked: false });
    expect(effectiveNotificationPreference('pic.taken_over', { toast: false, sound: true, muted: true })).toEqual({ toast: true, sound: true, muted: false, locked: true });
    expect(notificationTypesForRole('finance').map((e) => e.type)).toContain('payment.proof_new');
    expect(notificationTypesForRole('cs').map((e) => e.type)).not.toContain('wa.disconnected');
    expect(effectiveNotificationPreference('lead.unassigned', { toast: true, sound: false, muted: true })).toMatchObject({ muted: true });
    expect(notificationTypesForRole('admin').map((e) => e.type)).toContain('system.gateway_down');
  });
});
