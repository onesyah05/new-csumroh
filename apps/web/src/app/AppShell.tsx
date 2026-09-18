import { useEffect } from 'react';
import { BarChart3, BookOpen, Bot, Building2, ChevronDown, Inbox, KanbanSquare, LogOut, Menu, Settings2, Sparkles, Users, X } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAuth } from './auth';
import { useUiStore } from './store';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { AppErrorBoundary } from '../components/ui/AppErrorBoundary';

const mainNav = [
  { to: '/', label: 'Ringkasan', icon: BarChart3 },
  { to: '/inbox', label: 'Kotak masuk', icon: Inbox },
  { to: '/pipeline', label: 'Pipeline CRM', icon: KanbanSquare },
  { to: '/copilot', label: 'Copilot skrip', icon: Bot },
  { to: '/lms', label: 'Akademi CS', icon: BookOpen },
];
const titles: Record<string, string> = { '/': 'Ringkasan', '/inbox': 'Kotak masuk', '/pipeline': 'Pipeline CRM', '/copilot': 'Copilot skrip', '/lms': 'Akademi CS', '/admin': 'Administrasi' };

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { sidebarOpen, toggleSidebar, activeBrandId, setActiveBrandId } = useUiStore();
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<any[]>('/catalog/brands'), enabled: user?.role === 'superadmin' });
  useEffect(() => {
    if (user?.role !== 'superadmin' || !brands.data) return;
    const selectedStillExists = brands.data.some((brand) => brand.id === activeBrandId);
    if (!selectedStillExists) setActiveBrandId(brands.data[0]?.id ?? null);
  }, [activeBrandId, brands.data, setActiveBrandId, user]);
  useEffect(() => { if (sidebarOpen) toggleSidebar(); }, [location.pathname]);
  const pageTitle = location.pathname.startsWith('/prospects/') ? 'Profil Prospek' : titles[location.pathname] ?? 'CS Umroh';
  return <div className="min-h-screen bg-zinc-50/60">
    {sidebarOpen && <button aria-label="Tutup navigasi" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={toggleSidebar} />}
    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-zinc-200 bg-zinc-950 text-white transition-transform lg:translate-x-0', sidebarOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="noise absolute inset-0 pointer-events-none" />
      <div className="relative flex h-20 items-center justify-between px-5">
        <NavLink to="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white font-display text-sm font-extrabold text-black">CU</span><span><b className="block font-display text-sm tracking-tight">CS Umroh</b><span className="text-[10px] uppercase tracking-[.18em] text-zinc-400">Conversion desk</span></span></NavLink>
        <button className="text-zinc-400 lg:hidden" onClick={toggleSidebar}><X size={20} /></button>
      </div>
      <nav className="relative flex-1 space-y-1 px-3 py-5">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500">Workspace</p>
        {mainNav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white')}><Icon size={18} strokeWidth={1.8} />{label}</NavLink>)}
        {(user?.role === 'superadmin' || user?.role === 'admin') && <><p className="px-3 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500">Pengelolaan</p><NavLink to="/admin" className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white')}><Settings2 size={18} />Administrasi</NavLink></>}
      </nav>
      <div className="relative border-t border-zinc-800 p-3">
        <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-zinc-900"><span className="grid h-9 w-9 place-items-center rounded-full bg-zinc-800 text-xs font-bold">{user?.name.split(' ').map((n) => n[0]).slice(0,2).join('')}</span><span className="min-w-0 flex-1"><b className="block truncate text-xs">{user?.name}</b><span className="block truncate text-[10px] capitalize text-zinc-500">{user?.role} · {user?.brand?.name ?? 'Lintas brand'}</span></span><ChevronDown size={14} className="text-zinc-500" /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content side="top" align="end" sideOffset={8} className="z-50 w-52 rounded-xl border border-zinc-200 bg-white p-1 shadow-lift"><DropdownMenu.Item onSelect={() => void logout()} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none hover:bg-zinc-100"><LogOut size={15} />Keluar</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
      </div>
    </aside>
    <div className="lg:pl-[248px]">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur-xl sm:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleSidebar}><Menu size={20} /></Button>
        <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-zinc-400">CS Umroh / Workspace</p><h1 className="truncate font-display text-base font-bold">{pageTitle}</h1></div>
        {user?.role === 'superadmin' && <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button variant="secondary" size="sm"><Building2 size={15} />{brands.data?.find((b) => b.id === activeBrandId)?.name ?? (brands.isLoading ? 'Memuat brand' : 'Belum ada brand')}<ChevronDown size={14} /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-56 rounded-xl border bg-white p-1 shadow-lift">{brands.data?.map((brand) => <DropdownMenu.Item key={brand.id} onSelect={() => setActiveBrandId(brand.id)} className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none hover:bg-zinc-100">{brand.name}</DropdownMenu.Item>)}{!brands.data?.length&&<p className="px-3 py-2 text-xs text-zinc-400">Buat brand melalui menu Administrasi.</p>}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
        <div className="hidden items-center gap-2 rounded-full border bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-600" />Sistem aktif</div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8"><AppErrorBoundary compact resetKey={location.pathname}><Outlet /></AppErrorBoundary></main>
    </div>
  </div>;
}
