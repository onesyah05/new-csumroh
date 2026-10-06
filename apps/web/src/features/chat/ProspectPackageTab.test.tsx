// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '../../components/ui/button';
import { ProspectPackageTab } from './ProspectPackageTab';

afterEach(cleanup);

describe('Tab paket tanpa paket terpilih', () => {
  it('"Pilih paket" memakai tombol bersama (sama dengan "Lengkapi kualifikasi"), bukan tombol polos', () => {
    render(
      <ProspectPackageTab
        packages={[]} selected={null} qualification={{} as never} locked={false} saving={false} connected
        onSelect={vi.fn()} onSendFlyer={vi.fn()} onInsertSummary={vi.fn()} onInsertItinerary={vi.fn()}
        onOpenGallery={vi.fn()} onOpenQualification={vi.fn()}
      />,
    );
    // Tinggi tetap (h-8) dari komponen bersama: tombol polos ikut metrik font browser dan tampil beda di Chrome.
    expect(screen.getByRole('button', { name: 'Pilih paket' }).className).toBe(buttonVariants({ variant: 'secondary', size: 'sm' }));
  });
});
