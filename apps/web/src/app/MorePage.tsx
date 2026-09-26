import { Bell, BookOpen, Building2, ChevronRight, KanbanSquare, LogOut, PackageOpen, Radio, ShieldCheck, SlidersHorizontal, Smartphone, Users2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth';
import { InstallApp } from './pwa';

export function MorePage() {
  const { user, logout } = useAuth();
  const manager = user?.role === 'admin' || user?.role === 'superadmin';
  const product = user?.role === 'product';
  const finance = user?.role === 'finance';
  const items = [
    ...(!product ? [{ to: '/packages', label: 'Paket Umroh', icon: PackageOpen }] : []),
    ...(!product && !finance ? [{ to: '/lms', label: 'Akademi CS', icon: BookOpen }] : []),
    ...(!finance ? [{ to: '/layanan-custom', label: 'Layanan custom', icon: SlidersHorizontal }] : []),
    ...(finance ? [{ to: '/pipeline', label: 'Prospek', icon: KanbanSquare }] : []),
    ...(manager ? [
      { to: '/verifikasi', label: 'Verifikasi pembayaran awal', icon: ShieldCheck },
      { to: '/staff', label: 'Staf', icon: Users2 },
      { to: '/brands', label: 'Brand Travel', icon: Building2 },
      { to: '/devices', label: 'Perangkat WhatsApp', icon: Smartphone },
      { to: '/meta-capi', label: 'Meta CAPI', icon: Radio },
    ] : []),
    { to: '/pengaturan/notifikasi', label: 'Pengaturan notifikasi', icon: Bell },
  ];
  return <div className="app-page max-w-2xl">
    <div><h1 className="page-title">Lainnya</h1><p className="mt-2 text-sm text-zinc-600">{user?.name} · CRM Azhan</p></div>
    <div className="surface divide-y divide-zinc-100 overflow-hidden">{items.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-zinc-50"><Icon size={20} aria-hidden="true" /><span className="flex-1">{label}</span><ChevronRight size={18} aria-hidden="true" className="text-zinc-500" /></Link>)}</div>
    <InstallApp />
    <button type="button" onClick={() => void logout()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white text-sm font-medium"><LogOut size={18} aria-hidden="true" />Keluar dari akun</button>
  </div>;
}
