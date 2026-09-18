import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { AppShell } from './AppShell';
import { LoginPage } from '../features/auth/LoginPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { InboxPage } from '../features/chat/InboxPage';
import { PipelinePage } from '../features/prospects/PipelinePage';
import { ProspectDetailPage } from '../features/prospect-detail/ProspectDetailPage';
import { CopilotPage } from '../features/copilot/CopilotPage';
import { LmsPage } from '../features/lms/LmsPage';
import { AdminPage } from '../features/admin/AdminPage';
import { SocketBridge } from './socket';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center bg-zinc-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-zinc-700 border-t-white" /><p className="text-xs uppercase tracking-[.2em] text-zinc-400">Menyiapkan workspace</p></div></div>;
  if (!user) return <Routes><Route path="*" element={<LoginPage />} /></Routes>;
  return <><SocketBridge /><Routes><Route element={<AppShell />}><Route index element={<DashboardPage />} /><Route path="inbox" element={<InboxPage />} /><Route path="pipeline" element={<PipelinePage />} /><Route path="prospects/:id" element={<ProspectDetailPage />} /><Route path="copilot" element={<CopilotPage />} /><Route path="lms" element={<LmsPage />} /><Route path="admin" element={user.role === 'cs' ? <Navigate to="/" replace /> : <AdminPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes></>;
}
