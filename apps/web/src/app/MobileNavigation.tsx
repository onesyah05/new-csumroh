import { Home, Inbox, KanbanSquare, MoreHorizontal, ShieldCheck, SlidersHorizontal, Bell } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { cn } from '../lib/cn';

export function mobileDestinations(role?: string) {
  if (role === 'product') return [
    { to: '/layanan-custom', label: 'Layanan', icon: SlidersHorizontal },
    { to: '/pengaturan/notifikasi', label: 'Notifikasi', icon: Bell },
  ];
  return [
    { to: '/', label: 'Beranda', icon: Home },
    { to: '/inbox', label: 'Inbox', icon: Inbox },
    role === 'finance' ? { to: '/verifikasi', label: 'Verifikasi', icon: ShieldCheck }
      : { to: '/pipeline', label: 'Prospek', icon: KanbanSquare },
  ];
}

export function MobileNavigation() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  if (pathname === '/inbox' && ['prospectId', 'phone', 'jid'].some(key => params.has(key))) return null;
  const items = mobileDestinations(user?.role);
  const moreActive = !items.some(item => item.to === '/' ? pathname === '/' : pathname.startsWith(item.to))
    && !pathname.startsWith('/prospects/');
  return <nav aria-label="Navigasi utama mobile" className="mobile-navigation fixed inset-x-0 bottom-0 z-20 flex border-t border-zinc-200 bg-white md:hidden">
    {items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cn('flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium', isActive || (to === '/pipeline' && pathname.startsWith('/prospects/')) ? 'text-zinc-950' : 'text-zinc-500')}>
      {({ isActive }) => <><span className={cn('grid h-7 w-12 place-items-center rounded-full', (isActive || (to === '/pipeline' && pathname.startsWith('/prospects/'))) && 'bg-zinc-100')}><Icon size={21} aria-hidden="true" /></span>{label}</>}
    </NavLink>)}
    <NavLink to="/lainnya" aria-current={moreActive ? 'page' : undefined} className={cn('flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium', moreActive ? 'text-zinc-950' : 'text-zinc-500')}><span className={cn('grid h-7 w-12 place-items-center rounded-full', moreActive && 'bg-zinc-100')}><MoreHorizontal size={21} aria-hidden="true" /></span>Lainnya</NavLink>
  </nav>;
}
