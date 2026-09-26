import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { AppShell } from './AppShell';
import { LoginPage } from '../features/auth/LoginPage';
import { Toaster } from './toast';

// Setiap halaman dimuat saat dibuka: CS tidak mengunduh modul admin/paket/Meta yang tidak dipakainya.
function page<K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => loader().then((module) => ({ default: module[name] })));
}

const DashboardPage = page(() => import('../features/dashboard/DashboardPage'), 'DashboardPage');
const InboxPage = page(() => import('../features/chat/InboxPage'), 'InboxPage');
const PipelinePage = page(() => import('../features/prospects/PipelinePage'), 'PipelinePage');
const ProspectDetailPage = page(() => import('../features/prospect-detail/ProspectDetailPage'), 'ProspectDetailPage');
const LmsPage = page(() => import('../features/lms/LmsPage'), 'LmsPage');
const PackagesPage = page(() => import('../features/packages/PackagesPage'), 'PackagesPage');
const PackageDetailPage = page(() => import('../features/packages/PackageDetailPage'), 'PackageDetailPage');
const PackageFormPage = page(() => import('../features/packages/PackageFormPage'), 'PackageFormPage');
const BrandPage = page(() => import('../features/brand/BrandPage'), 'BrandPage');
const BrandDetailPage = page(() => import('../features/brand/BrandDetailPage'), 'BrandDetailPage');
const BrandFormPage = page(() => import('../features/brand/BrandFormPage'), 'BrandFormPage');
const DevicePage = page(() => import('../features/device/DevicePage'), 'DevicePage');
const DeviceDetailPage = page(() => import('../features/device/DeviceDetailPage'), 'DeviceDetailPage');
const StaffPage = page(() => import('../features/staff/StaffPage'), 'StaffPage');
const VerificationPage = page(() => import('../features/finance/VerificationPage'), 'VerificationPage');
const MetaCapiPage = page(() => import('../features/meta/MetaCapiPage'), 'MetaCapiPage');
const CustomRequestsPage = page(() => import('../features/custom/CustomRequestsPage'), 'CustomRequestsPage');
const NotificationSettingsPage = page(() => import('../features/notifications/NotificationSettingsPage'), 'NotificationSettingsPage');
const MorePage = page(() => import('./MorePage'), 'MorePage');
// socket.io-client (±40 KB) baru diunduh setelah login, bukan di halaman login.
const SocketBridge = page(() => import('./socket'), 'SocketBridge');

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center bg-zinc-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-zinc-700 border-t-white" /><p className="text-xs text-zinc-400">Menyiapkan workspace</p></div></div>;
  if (!user) return <Routes><Route path="*" element={<LoginPage />} /></Routes>;

  // Menu pengelolaan (staf, brand, perangkat, Meta) hanya untuk superadmin/admin — sama dengan navigasi.
  const isManager = user.role === 'superadmin' || user.role === 'admin';
  const managerOnly = (element: JSX.Element) => (isManager ? element : <Navigate to="/" replace />);
  const superadminOnly = (element: JSX.Element, fallback: string) => (user.role === 'superadmin' ? element : <Navigate to={fallback} replace />);
  const canEditPackages = user.role === 'superadmin' || user.role === 'admin';
  const canVerifyPayments = user.role === 'finance' || isManager;
  // Tim LA hanya mengelola Layanan Custom (semua brand), tidak membuka prospek/chat.
  if (user.role === 'product') {
    return (
      <>
        <Suspense fallback={null}><SocketBridge /></Suspense>
        <Toaster />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="lainnya" element={<MorePage />} />
            <Route path="layanan-custom" element={<CustomRequestsPage />} />
            <Route path="pengaturan/notifikasi" element={<NotificationSettingsPage />} />
            <Route path="*" element={<Navigate to="/layanan-custom" replace />} />
          </Route>
        </Routes>
      </>
    );
  }

  return (
    <>
      <Suspense fallback={null}><SocketBridge /></Suspense>
      <Toaster />
      <Routes>
          <Route element={<AppShell />}>
            <Route path="lainnya" element={<MorePage />} />
            <Route index element={<DashboardPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="pipeline" element={<PipelinePage />} />
            <Route path="prospects/:id" element={<ProspectDetailPage />} />
            <Route path="verifikasi" element={canVerifyPayments ? <VerificationPage /> : <Navigate to="/" replace />} />
            <Route path="packages" element={<PackagesPage />} />
            <Route path="packages/new" element={canEditPackages ? <PackageFormPage /> : <Navigate to="/packages" replace />} />
            <Route path="packages/:id" element={<PackageDetailPage />} />
            <Route path="packages/:id/edit" element={canEditPackages ? <PackageFormPage /> : <Navigate to="/packages" replace />} />
            <Route path="copilot" element={<Navigate to="/inbox" replace />} />
            <Route path="lms" element={<LmsPage />} />
            <Route path="layanan-custom" element={user.role === 'finance' ? <Navigate to="/" replace /> : <CustomRequestsPage />} />
            <Route path="brands" element={managerOnly(<BrandPage />)} />
            <Route path="brands/new" element={superadminOnly(<BrandFormPage />, '/brands')} />
            <Route path="brands/:brandId" element={managerOnly(<BrandDetailPage />)} />
            <Route path="brands/:brandId/edit" element={superadminOnly(<BrandFormPage />, '/brands')} />
            <Route path="devices" element={managerOnly(<DevicePage />)} />
            <Route path="devices/:brandId" element={managerOnly(<DeviceDetailPage />)} />
            <Route path="staff" element={managerOnly(<StaffPage />)} />
            <Route path="meta-capi" element={managerOnly(<MetaCapiPage />)} />
            <Route path="pengaturan/notifikasi" element={<NotificationSettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
      </Routes>
    </>
  );
}
