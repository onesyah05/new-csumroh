import { Bell, BookOpen, Building2, ChevronRight, Image as ImageIcon, LogOut, PackageOpen, ShieldCheck, SlidersHorizontal, TrendingUp, Users2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth';
import { InstallApp } from './pwa';

const ROLE_LABEL: Record<string, string> = { superadmin: 'Superadmin', admin: 'Admin', cs: 'CS', finance: 'Finance', product: 'Tim LA', designer: 'Designer' };

export function MorePage() {
  const { user, logout } = useAuth();
  const manager = user?.role === 'admin' || user?.role === 'superadmin';
  const product = user?.role === 'product';
  const finance = user?.role === 'finance';
  const designer = user?.role === 'designer';
  const items = [
    ...(!product && !designer ? [{ to: '/packages', label: 'Paket Umroh', icon: PackageOpen }] : []),
    ...(!product && !finance && !designer ? [{ to: '/lms', label: 'Akademi CS', icon: BookOpen }] : []),
    ...(!finance && !designer ? [{ to: '/layanan-custom', label: product || user?.role === 'superadmin' ? 'Layanan custom' : 'Status custom', icon: SlidersHorizontal }] : []),
    ...(manager ? [
      { to: '/template-itinerary', label: 'Template itinerary', icon: ImageIcon },
      { to: '/laporan', label: 'Laporan', icon: TrendingUp },
      { to: '/verifikasi', label: 'Verifikasi pembayaran', icon: ShieldCheck },
      { to: '/staff', label: 'Staf', icon: Users2 },
      { to: '/brands', label: 'Brand Travel', icon: Building2 },
    ] : []),
    ...(!designer ? [{ to: '/pengaturan/notifikasi', label: 'Pengaturan notifikasi', icon: Bell }] : []),
  ];
  return <div className="app-page max-w-2xl">
    <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-950 text-sm font-bold text-white" aria-hidden="true">{(user?.name ?? '?').split(/s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span><div className="min-w-0"><h1 className="truncate text-base font-bold text-zinc-950">{user?.name}</h1><p className="text-xs text-zinc-500">{ROLE_LABEL[user?.role ?? ''] ?? ''}</p></div></div>
    <div className="surface divide-y divide-zinc-100 overflow-hidden">{items.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm font-medium hover:bg-zinc-50"><Icon size={20} aria-hidden="true" /><span className="flex-1">{label}</span><ChevronRight size={18} aria-hidden="true" className="text-zinc-500" /></Link>)}</div>
    <InstallApp />
    <button type="button" onClick={() => void logout()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white text-sm font-medium text-rose-700"><LogOut size={18} aria-hidden="true" />Keluar dari akun</button>
  </div>;
}
