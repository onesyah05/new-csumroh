/** Galeri media bersama per brand: batas ukuran, role yang boleh memakai, dan penanda pesan media tanpa keterangan. */
export const GALLERY_ROLES = ['superadmin', 'admin', 'cs', 'finance'] as const;
export const canUseGallery = (role?: string | null) => (GALLERY_ROLES as readonly string[]).includes(role ?? '');

export const GALLERY_IMAGE_MAX_MB = 12;
export const GALLERY_VIDEO_MAX_MB = 16;

/** Teks yang disimpan untuk foto/video tanpa keterangan; UI menyembunyikannya. */
export const MEDIA_PLACEHOLDER = { image: '[Gambar]', video: '[Video]' } as const;

/** Pesan lama menyimpan nama berkas sebagai teks foto/video; nama berkas tidak perlu tampil di bubble. */
export const isMediaFileNameText = (text: string) => /^[^\n]{1,200}\.(?:webp|jpe?g|png|gif|mp4|mov|3gp)$/i.test(text.trim());
