import { Suspense, useEffect, useState } from 'react';
import { BarChart3, Bell, BookOpen, Building2, ChevronDown, Inbox, KanbanSquare, LogOut, Menu, PackageOpen, Radio, ShieldCheck, Smartphone, SlidersHorizontal, Users2, X } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAuth } from './auth';
import { useUiStore } from './store';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { AppErrorBoundary } from '../components/ui/AppErrorBoundary';
import { PageLoading } from '../components/ui/page-feedback';
import { NotificationBell, useNotificationTitle } from '../features/notifications/NotificationBell';

/** Nama peran untuk pengguna; kode peran (mis. `product` = Tim LA) tidak ditampilkan. */
const ROLE_LABELS: Record<string, string> = { superadmin: 'Superadmin', admin: 'Admin', cs: 'CS', finance: 'Finance', product: 'Tim LA' };

const mainNav: { to: string; label: string; icon: typeof BarChart3; roles?: string[] }[] = [
  { to: '/', label: 'Ringkasan', icon: BarChart3, roles: ['superadmin', 'admin', 'cs', 'finance'] },
  { to: '/inbox', label: 'Kotak masuk', icon: Inbox, roles: ['superadmin', 'admin', 'cs', 'finance'] },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare, roles: ['superadmin', 'admin', 'cs', 'finance'] },
  { to: '/layanan-custom', label: 'Layanan custom', icon: SlidersHorizontal, roles: ['product', 'superadmin', 'admin', 'cs'] },
  { to: '/verifikasi', label: 'Verifikasi', icon: ShieldCheck, roles: ['finance', 'admin', 'superadmin'] },
  { to: '/packages', label: 'Paket Umroh', icon: PackageOpen, roles: ['superadmin', 'admin', 'cs', 'finance'] },
  // Materi melayani jamaah: tidak relevan untuk Finance.
  { to: '/lms', label: 'Akademi CS', icon: BookOpen, roles: ['cs', 'admin', 'superadmin'] },
];
const titles: Record<string, string> = {
  '/': 'Ringkasan',
  '/inbox': 'Kotak masuk',
  '/pipeline': 'Pipeline',
  '/pengaturan/notifikasi': 'Pengaturan Notifikasi',
  '/verifikasi': 'Verifikasi Pembayaran',
  '/packages': 'Paket Umroh',
  '/packages/new': 'Tambah Paket',
  '/lms': 'Akademi CS',
  '/layanan-custom': 'Layanan custom',
  '/brands': 'Brand Travel',
  '/devices': 'Perangkat WhatsApp',
  '/staff': 'Staf',
  '/meta-capi': 'Meta Conversions API',
};

/**
 * Halaman yang datanya mengikuti brand aktif. Hanya di sini pemilih brand header ditampilkan; halaman
 * lintas brand (Ringkasan, Verifikasi, Paket, Staf, Meta CAPI) memakai filter di halamannya sendiri, dan
 * halaman lain (Brand, Perangkat, Akademi, Pengaturan) tidak bergantung pada brand aktif.
 * Inbox punya pemilih brand di header percakapannya.
 */
function followsActiveBrand(pathname: string) {
  return pathname === '/pipeline' || pathname.startsWith('/prospects/');
}

/**
 * Status koneksi realtime hanya ditampilkan saat bermasalah: pengguna tidak perlu indikator hijau permanen,
 * tetapi perlu tahu bila data berhenti diperbarui otomatis. "Menyambung ulang" baru tampil setelah 4 detik
 * agar tidak berkedip saat halaman dibuka.
 */
export function RealtimeIndicator() {
  const status = useUiStore((state) => state.realtimeStatus);
  const [slowReconnect, setSlowReconnect] = useState(false);
  useEffect(() => {
    if (status !== 'connecting') { setSlowReconnect(false); return; }
    const timer = setTimeout(() => setSlowReconnect(true), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const visible = status === 'offline' || (status === 'connecting' && slowReconnect);
  return (
    <div role="status" aria-live="polite" className="contents">
      {visible && (
        <span
          title="Data tidak diperbarui otomatis. Halaman menyinkronkan ulang saat koneksi pulih; muat ulang bila perlu."
          className={cn(
            'inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium',
            status === 'offline' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-zinc-200 bg-white text-zinc-600',
          )}
        >
          <span className={cn('h-2 w-2 shrink-0 rounded-full', status === 'offline' ? 'bg-amber-500' : 'bg-zinc-400 animate-pulse')} aria-hidden="true" />
          {status === 'offline' ? 'Pembaruan otomatis terhenti' : 'Menyambung ulang…'}
        </span>
      )}
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useNotificationTitle();
  const { sidebarOpen, toggleSidebar, activeBrandId, setActiveBrandId } = useUiStore();
  // Backend hanya mengembalikan brand yang boleh diakses user (semua untuk holding, UserBrand untuk CS).
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<any[]>('/catalog/brands'), enabled: !!user });

  useEffect(() => {
    if (!user || !brands.data) return;
    const selectedStillExists = brands.data.some((brand) => brand.id === activeBrandId);
    if (selectedStillExists) return;
    const primary = brands.data.find((brand) => brand.id === user.brandId);
    setActiveBrandId(primary?.id ?? brands.data[0]?.id ?? null);
  }, [activeBrandId, brands.data, setActiveBrandId, user]);

  useEffect(() => {
    if (sidebarOpen) toggleSidebar();
  }, [location.pathname]);

  const getBreadcrumbs = () => {
    const p = location.pathname;

    if (p === '/') {
      // Judul besar "Ringkasan" sudah tepat di bawahnya; breadcrumb tidak perlu mengulang.
      return [];
    }
    if (p === '/inbox') {
      return [{ label: 'Kotak masuk' }];
    }
    if (p === '/pipeline') {
      return [{ label: 'Pipeline CRM' }];
    }
    if (p.startsWith('/prospects/')) {
      return [{ to: '/pipeline', label: 'Pipeline CRM' }, { label: 'Profil Prospek' }];
    }
    if (p === '/packages') {
      return [{ label: 'Paket Umroh' }];
    }
    if (p === '/packages/new') {
      return [{ to: '/packages', label: 'Paket Umroh' }, { label: 'Tambah Paket' }];
    }
    if (p.startsWith('/packages/') && p.endsWith('/edit')) {
      return [{ to: '/packages', label: 'Paket Umroh' }, { label: 'Ubah Paket' }];
    }
    if (p.startsWith('/packages/')) {
      return [{ to: '/packages', label: 'Paket Umroh' }, { label: 'Detail Paket' }];
    }
    if (p === '/brands') {
      return [{ label: 'Brand Travel' }];
    }
    if (p === '/brands/new') {
      return [{ to: '/brands', label: 'Brand Travel' }, { label: 'Tambah Brand' }];
    }
    if (p.startsWith('/brands/') && p.endsWith('/edit')) {
      return [{ to: '/brands', label: 'Brand Travel' }, { label: 'Ubah Brand' }];
    }
    if (p.startsWith('/brands/')) {
      return [{ to: '/brands', label: 'Brand Travel' }, { label: 'Detail Brand' }];
    }
    if (p === '/devices') {
      return [{ label: 'Perangkat WhatsApp' }];
    }
    if (p.startsWith('/devices/')) {
      return [{ to: '/devices', label: 'Perangkat WhatsApp' }, { label: 'Kelola Perangkat' }];
    }
    if (p === '/staff') {
      return [{ label: 'Staf' }];
    }
    if (p === '/meta-capi') {
      return [{ label: 'Meta Conversions API' }];
    }
    if (p === '/layanan-custom') {
      return [{ label: 'Layanan custom' }];
    }
    if (p === '/lms') {
      return [{ label: 'Akademi CS' }];
    }
    return [{ label: titles[p] ?? 'Halaman' }];
  };

  return (
    <div className="min-h-screen bg-zinc-50/60">
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <button
          aria-label="Tutup navigasi"
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar: Default collapsed mini rail (72px, 1:1 icon ratio), expands to 252px on hover */}
      <aside
        className={cn(
          'group/sidebar fixed inset-y-0 left-0 z-40 flex flex-col border-r border-zinc-800 bg-zinc-950 text-white overflow-hidden',
          'transition-[width,box-shadow,transform] duration-300 ease-in-out',
          sidebarOpen ? 'translate-x-0 w-[252px]' : '-translate-x-full w-[252px]',
          'lg:translate-x-0 lg:w-[72px] lg:hover:w-[252px] lg:hover:shadow-[12px_0_35px_rgba(0,0,0,0.35)]'
        )}
      >
        <div className="noise absolute inset-0 pointer-events-none" />

        {/* Logo & Brand Header: 1:1 40x40 box at 16px offset */}
        <div className="relative flex h-20 shrink-0 items-center justify-between px-4">
          <NavLink to="/" className="flex items-center min-w-0" title="CRM AZHAN">
            <span className="grid h-10 w-10 shrink-0 aspect-square place-items-center rounded-xl bg-white font-display text-sm font-extrabold text-black shadow-sm">
              AZ
            </span>
            <span className="min-w-0 overflow-hidden transition-all duration-300 block lg:hidden lg:group-hover/sidebar:block opacity-100 max-w-[180px] lg:opacity-0 lg:max-w-0 lg:group-hover/sidebar:opacity-100 lg:group-hover/sidebar:max-w-[180px] ml-3">
              <b className="block truncate font-display text-sm tracking-tight text-white">CRM AZHAN</b>
              <span className="block truncate text-xs uppercase tracking-[.18em] text-zinc-400">Conversion desk</span>
            </span>
          </NavLink>
          <button className="text-zinc-400 lg:hidden p-1 hover:text-white" onClick={toggleSidebar} aria-label="Tutup navigasi">
            <X size={20} />
          </button>
        </div>

        {/* Notifikasi: item pertama di bawah logo — titik pertama yang dilihat mata, sama di semua halaman
            (termasuk Inbox yang tanpa header). Di layar kecil lonceng ada di header halaman/Inbox. */}
        <div className="relative hidden shrink-0 px-4 pb-2 lg:block">
          <NotificationBell placement="sidebar" />
        </div>

        {/* Main Navigation Links: Exact 1:1 40x40 centered square items when collapsed */}
        <nav className="relative flex-1 space-y-2 px-4 py-2 overflow-y-auto thin-scrollbar overflow-x-hidden">
          <div className="block lg:hidden lg:group-hover/sidebar:block pb-1">
            <p className="text-xs font-bold uppercase tracking-[.16em] text-zinc-400 whitespace-nowrap px-1">
              Workspace
            </p>
          </div>

          {mainNav.filter((item) => !item.roles || item.roles.includes(user?.role ?? '')).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={label}
              className={({ isActive }) =>
                cn(
                  'flex items-center rounded-xl text-sm font-medium transition-all duration-200',
                  'h-10 w-full justify-start px-3 gap-3 aspect-auto',
                  'lg:h-10 lg:w-10 lg:aspect-square lg:justify-center lg:p-0 lg:px-0 lg:py-0 lg:gap-0',
                  'lg:group-hover/sidebar:w-full lg:group-hover/sidebar:justify-start lg:group-hover/sidebar:aspect-auto lg:group-hover/sidebar:px-3 lg:group-hover/sidebar:gap-3',
                  isActive
                    ? 'bg-white text-zinc-950 font-bold shadow-sm'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                )
              }
            >
              <Icon size={20} strokeWidth={1.9} className="shrink-0" />
              <span
                className={cn(
                  'truncate whitespace-nowrap transition-all duration-300',
                  'block max-w-[180px] opacity-100',
                  'lg:hidden lg:max-w-0 lg:opacity-0',
                  'lg:group-hover/sidebar:inline-block lg:group-hover/sidebar:max-w-[180px] lg:group-hover/sidebar:opacity-100'
                )}
              >
                {label}
              </span>
            </NavLink>
          ))}

          {/* Brand & Device nav — hanya untuk superadmin/admin */}
          {(user?.role === 'superadmin' || user?.role === 'admin') && (
            <>
              <div className="py-2">
                <div className="block lg:hidden lg:group-hover/sidebar:block pb-1">
                  <p className="text-xs font-bold uppercase tracking-[.16em] text-zinc-400 whitespace-nowrap px-1">
                    Pengelolaan
                  </p>
                </div>
                <div className="h-px bg-zinc-800/80 mx-auto w-8 lg:group-hover/sidebar:w-full transition-all duration-300" />
              </div>
              {[
                { to: '/staff', label: 'Staf', icon: Users2 },
                { to: '/brands', label: 'Brand Travel', icon: Building2 },
                { to: '/devices', label: 'Perangkat WhatsApp', icon: Smartphone },
                { to: '/meta-capi', label: 'Meta CAPI', icon: Radio },
              ].map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={label}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center rounded-xl text-sm font-medium transition-all duration-200',
                      'h-10 w-full justify-start px-3 gap-3 aspect-auto',
                      'lg:h-10 lg:w-10 lg:aspect-square lg:justify-center lg:p-0 lg:px-0 lg:py-0 lg:gap-0',
                      'lg:group-hover/sidebar:w-full lg:group-hover/sidebar:justify-start lg:group-hover/sidebar:aspect-auto lg:group-hover/sidebar:px-3 lg:group-hover/sidebar:gap-3',
                      isActive
                        ? 'bg-white text-zinc-950 font-bold shadow-sm'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                    )
                  }
                >
                  <Icon size={20} strokeWidth={1.9} className="shrink-0" />
                  <span
                    className={cn(
                      'truncate whitespace-nowrap transition-all duration-300',
                      'block max-w-[180px] opacity-100',
                      'lg:hidden lg:max-w-0 lg:opacity-0',
                      'lg:group-hover/sidebar:inline-block lg:group-hover/sidebar:max-w-[180px] lg:group-hover/sidebar:opacity-100'
                    )}
                  >
                    {label}
                  </span>
                </NavLink>
              ))}
            </>
          )}

        </nav>

        {/* User Account / Profile Footer: 1:1 40x40 avatar square at 16px offset */}
        <div className="relative border-t border-zinc-800 p-4 shrink-0">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={cn(
                  'flex items-center rounded-xl text-left hover:bg-zinc-900 transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-zinc-700',
                  'h-10 w-full justify-start p-0 gap-3 aspect-auto',
                  'lg:w-10 lg:aspect-square lg:justify-center lg:p-0 lg:px-0 lg:py-0 lg:gap-0',
                  'lg:group-hover/sidebar:w-full lg:group-hover/sidebar:justify-start lg:group-hover/sidebar:aspect-auto lg:group-hover/sidebar:p-1 lg:group-hover/sidebar:gap-3'
                )}
                title={user?.name}
              >
                <span className="grid h-10 w-10 shrink-0 aspect-square place-items-center rounded-xl bg-zinc-800 text-xs font-bold text-white shadow-sm">
                  {user?.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden transition-all duration-300 block lg:hidden lg:group-hover/sidebar:block opacity-100 max-w-[160px] lg:opacity-0 lg:max-w-0 lg:group-hover/sidebar:opacity-100 lg:group-hover/sidebar:max-w-[160px]">
                  <b className="block truncate text-xs text-white">{user?.name}</b>
                  <span className="block truncate text-xs text-zinc-400">
                    {ROLE_LABELS[user?.role ?? ''] ?? user?.role} · {user?.brand?.name ?? 'Lintas brand'}
                  </span>
                </span>
                <ChevronDown size={14} className="shrink-0 text-zinc-500 transition-all duration-300 block lg:hidden lg:group-hover/sidebar:block" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="top"
                align="center"
                sideOffset={8}
                className="z-50 w-52 rounded-xl border border-zinc-200 bg-white p-1 shadow-lift animate-fade-up"
              >
                <div className="px-3 py-2 border-b border-zinc-100">
                  <p className="text-xs font-bold text-zinc-900 truncate">{user?.name}</p>
                  <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
                </div>
                <DropdownMenu.Item
                  onSelect={() => navigate('/pengaturan/notifikasi')}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none hover:bg-zinc-100 transition data-[highlighted]:bg-zinc-100"
                >
                  <Bell size={15} />Pengaturan notifikasi
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => void logout()}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600 outline-none hover:bg-rose-50 transition data-[highlighted]:bg-rose-50"
                >
                  <LogOut size={15} />Keluar
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </aside>

      {/* Main Content Area - Placed with lg:pl-[72px] for mini rail mode */}
      <div className="transition-[padding] duration-300 lg:pl-[72px]">
        {location.pathname !== '/inbox' && (
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-zinc-200/90 bg-white/80 px-4 backdrop-blur-md sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={toggleSidebar}>
                <Menu size={18} />
              </Button>
              <nav className="flex items-center gap-1.5 min-w-0 text-xs" aria-label="Breadcrumb">
                <NavLink to="/" className="font-medium text-zinc-500 hover:text-zinc-800 transition shrink-0">
                  CRM AZHAN
                </NavLink>
                {getBreadcrumbs().map((item, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  return (
                    <span key={idx} className="flex items-center gap-1.5 min-w-0">
                      <span className="text-zinc-500 select-none">/</span>
                      {item.to && !isLast ? (
                        <NavLink to={item.to} className="font-medium text-zinc-500 hover:text-zinc-900 transition truncate">
                          {item.label}
                        </NavLink>
                      ) : (
                        <span className={cn('truncate font-semibold text-xs sm:text-sm', isLast ? 'text-zinc-950' : 'text-zinc-500')}>
                          {item.label}
                        </span>
                      )}
                    </span>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {(brands.data?.length ?? 0) > 1 && followsActiveBrand(location.pathname) && (
                <Select
                  value={activeBrandId ? String(activeBrandId) : ''}
                  onValueChange={(value) => setActiveBrandId(Number(value))}
                  options={(brands.data ?? []).map((brand) => ({ value: String(brand.id), label: brand.name }))}
                  placeholder="Pilih brand"
                  className="w-40 sm:w-52"
                  aria-label="Brand aktif"
                />
              )}
              <RealtimeIndicator />
              <NotificationBell placement="header" className="lg:hidden" />
            </div>
          </header>
        )}
        <main className={cn('mx-auto', location.pathname === '/inbox' ? 'h-screen p-0 max-w-none overflow-hidden' : 'max-w-[1600px] p-4 sm:p-6 lg:p-8')}>
          <AppErrorBoundary compact resetKey={location.pathname}>
            <Suspense fallback={<PageLoading label="Memuat halaman…" />}>
              <Outlet />
            </Suspense>
          </AppErrorBoundary>
        </main>
      </div>
    </div>
  );
}
