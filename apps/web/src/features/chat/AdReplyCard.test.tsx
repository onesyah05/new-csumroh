// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AdReplyCard } from './AdReplyCard';

afterEach(cleanup);

describe('AdReplyCard', () => {
  it('shows the ad image, headline and ad name like the WhatsApp ad preview', () => {
    const { container } = render(
      <AdReplyCard ad={{ adId: '120250004432660412', title: 'Umroh Desember', body: null, adName: 'IMG - DES - 003', thumbnailUrl: 'https://scontent.fbcdn.net/a.jpg', sourceUrl: null }} />,
    );
    expect(screen.getByText('Ad')).toBeTruthy();
    expect(screen.getByText('Umroh Desember')).toBeTruthy();
    expect(screen.getByText('IMG - DES - 003')).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://scontent.fbcdn.net/a.jpg');
  });

  it('falls back to an icon and a generic label without image or headline', () => {
    const { container } = render(<AdReplyCard ad={{ adId: null, title: null, body: null, adName: null, thumbnailUrl: null, sourceUrl: null }} />);
    expect(screen.getByText('Iklan')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});
