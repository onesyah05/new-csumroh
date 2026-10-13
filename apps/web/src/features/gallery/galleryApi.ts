import { GALLERY_IMAGE_MAX_MB, GALLERY_VIDEO_MAX_MB } from '@csumroh/shared-types';
import { api, resolveMediaUrl } from '../../lib/api';
import { autoCompressMedia } from '../chat/mediaCompressor';

export interface GalleryAsset {
  id: number;
  brandId: number;
  folderId: number | null;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedBy: { id: number; name: string } | null;
}

export interface GalleryFolder { id: number; name: string; count: number }
export interface GalleryFolders { total: number; folders: GalleryFolder[] }
export interface GalleryAssetPage { items: GalleryAsset[]; nextCursor: number | null }

export const GALLERY_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4';
/** Foto HP bisa jauh di atas batas galeri; dikecilkan di browser dulu, jadi batas mentahnya longgar. */
const RAW_IMAGE_LIMIT_MB = 40;

const GALLERY_TYPES = new Set(GALLERY_ACCEPT.split(','));

/** Berkas yang boleh diunggah ke galeri (folder yang diseret bertipe kosong dan ikut tersaring). */
export const isGalleryFile = (file: File) => GALLERY_TYPES.has(file.type);

export const isVideoAsset = (asset: Pick<GalleryAsset, 'mimeType'>) => asset.mimeType.startsWith('video/');

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
    reader.readAsDataURL(file);
  });
}

/** Satu berkas ke galeri. Gambar dikecilkan di browser dulu; ukuran dicek setelah itu, server memeriksa sekali lagi. */
export async function uploadGalleryFile(brandId: number, file: File, folderId: number | null): Promise<GalleryAsset> {
  const isVideo = file.type.startsWith('video/');
  if (!isVideo && !file.type.startsWith('image/')) throw new Error(file.name + ': hanya gambar dan video MP4.');
  if (isVideo && file.size > GALLERY_VIDEO_MAX_MB * 1024 * 1024) throw new Error(file.name + ': video maksimal ' + GALLERY_VIDEO_MAX_MB + ' MB.');
  if (!isVideo && file.size > RAW_IMAGE_LIMIT_MB * 1024 * 1024) throw new Error(file.name + ': gambar terlalu besar.');
  const prepared = isVideo ? file : (await autoCompressMedia(file)).file;
  if (!isVideo && prepared.size > GALLERY_IMAGE_MAX_MB * 1024 * 1024) throw new Error(file.name + ': gambar maksimal ' + GALLERY_IMAGE_MAX_MB + ' MB.');
  const data = await readAsDataUrl(prepared);
  return api.post<GalleryAsset>('/gallery/assets', { brandId, name: file.name, data, folderId });
}

/** Unduh isi media galeri sebagai File (cookie media ikut terkirim) untuk dilampirkan ke chat. */
export async function galleryAssetToFile(asset: GalleryAsset): Promise<File> {
  const response = await fetch(resolveMediaUrl(asset.url), { credentials: 'include' });
  if (!response.ok) throw new Error('Gagal mengambil media dari galeri.');
  const blob = await response.blob();
  const base = asset.name.replace(/\.[^.]+$/, '');
  const extension = asset.mimeType === 'video/mp4' ? 'mp4' : 'webp';
  return new File([blob], base + '.' + extension, { type: asset.mimeType });
}
