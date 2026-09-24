import { useEffect, useState } from 'react';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';

export interface ProspectAvatarProps {
  /** Foto profil WhatsApp (salinan lokal `/uploads/avatars/...`, dibuat oleh API). */
  photoUrl?: string | null;
  /** Hanya untuk kompatibilitas pemanggil; nama tidak dipakai sebagai inisial maupun alt. */
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClass = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
  xl: 'h-12 w-12',
} as const;

/**
 * Avatar prospek = foto profil WhatsApp. Kontak tanpa foto (atau foto gagal dimuat) tampil dengan siluet
 * default seperti di WhatsApp — tidak memakai inisial, yang menyesatkan untuk nama non-Latin atau nomor.
 * Dekoratif: nama selalu tampil sebagai teks di sebelahnya, jadi gambar disembunyikan dari pembaca layar.
 */
export function ProspectAvatar({ photoUrl, size = 'md', className }: ProspectAvatarProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [photoUrl]);

  const frame = cn('relative shrink-0 overflow-hidden rounded-full border border-zinc-200/90 bg-zinc-200 shadow-2xs', sizeClass[size], className);

  if (photoUrl && !hasError) {
    return (
      <span className={frame} aria-hidden="true">
        <img
          src={resolveMediaUrl(photoUrl)}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
        />
      </span>
    );
  }

  return (
    <span className={frame} aria-hidden="true" data-avatar="placeholder">
      <svg viewBox="0 0 40 40" className="h-full w-full text-zinc-500" fill="currentColor">
        <circle cx="20" cy="15.5" r="7.5" />
        <path d="M6 37c0-7.7 6.3-13 14-13s14 5.3 14 13v3H6z" />
      </svg>
    </span>
  );
}
