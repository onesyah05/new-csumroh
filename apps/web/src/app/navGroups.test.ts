// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { navGroupsFor } from './AppShell';

const shape = (role: string) => navGroupsFor(role).map((g) => [g.label, g.items.map((i) => i.label)]);

describe('Navigasi sidebar per role', () => {
  it('CS: kerja harian dulu; status custom di Utama; tanpa Verifikasi & Pengelolaan', () => {
    expect(shape('cs')).toEqual([
      ['Utama', ['Ringkasan', 'Kotak masuk', 'Pipeline', 'Status custom', 'Paket Umroh', 'Akademi CS']],
    ]);
  });

  it('Finance: mulai dari Verifikasi, tanpa Ringkasan & Akademi', () => {
    expect(shape('finance')).toEqual([
      ['Operasional', ['Verifikasi']],
      ['Utama', ['Kotak masuk', 'Pipeline', 'Paket Umroh']],
    ]);
  });

  it('Tim LA hanya antrean Layanan custom', () => {
    expect(shape('product')).toEqual([['Operasional', ['Layanan custom']]]);
  });

  it('Admin & Superadmin: Pengaturan cukup Staf & Brand (perangkat/Meta ada di detail Brand)', () => {
    expect(shape('admin')).toEqual([
      ['Utama', ['Ringkasan', 'Laporan', 'Kotak masuk', 'Pipeline', 'Status custom', 'Paket Umroh', 'Akademi CS']],
      ['Operasional', ['Verifikasi']],
      ['Pengaturan', ['Staf', 'Brand Travel']],
    ]);
    expect(shape('superadmin')[1]).toEqual(['Operasional', ['Layanan custom', 'Verifikasi']]);
  });
});
