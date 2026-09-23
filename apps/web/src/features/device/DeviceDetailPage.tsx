import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { StatusBadge } from '../../components/ui/status-badge';
import { WhatsAppDevicePanel } from '../admin/WhatsAppDevicePanel';

export function DeviceDetailPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<any[]>('/catalog/brands'),
  });

  if (brands.isLoading) return <PageLoading label="Memuat data brand…" />;
  if (brands.isError) return <PageError description={brands.error.message} onRetry={() => void brands.refetch()} />;

  const brand = brands.data?.find((b) => String(b.id) === brandId);

  if (!brand) {
    return (
      <PageError
        title="Brand tidak ditemukan"
        description="Brand dengan ID tersebut tidak ada atau Anda tidak memiliki akses."
        onRetry={() => navigate('/devices')}
      />
    );
  }

  const canManage = user?.role === 'superadmin';
  const isConnected = brand.whatsappSession?.status === 'connected';

  return (
    <div className="app-page space-y-6">
      <PageHeader
        backUrl="/devices"
        title={brand.name}
        badges={
          <>
            {brand.code && (
              <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-700">
                {brand.code}
              </span>
            )}
            <StatusBadge
              status={isConnected ? 'active' : 'neutral'}
              label={isConnected ? 'WA Terhubung' : 'WA Belum Terhubung'}
              dot
            />
          </>
        }
        subtitle={`Sesi WhatsApp Web untuk ${brand.name} · ${isConnected ? 'Siap kirim & terima pesan' : 'Perlu scan QR code'}`}
      />

      {/* Panel */}
      <WhatsAppDevicePanel
        brandId={brand.id}
        brandName={brand.name}
        canManage={canManage}
      />
    </div>
  );
}
