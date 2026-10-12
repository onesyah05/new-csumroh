import { PageError } from '../../components/ui/page-feedback';
import { useBrandScope } from '../../lib/scope';
import { GalleryBrowser } from './GalleryBrowser';

/** Galeri media bersama untuk brand aktif; unggah dan hapus dari dashboard. */
export function GalleryPage() {
  const { brandId } = useBrandScope();
  if (!brandId) return <PageError title="Brand belum dipilih" description="Pilih brand untuk membuka galeri." />;
  return (
    <div className="app-page max-w-6xl">
      <GalleryBrowser key={brandId} brandId={brandId} mode="page" />
    </div>
  );
}

export default GalleryPage;
