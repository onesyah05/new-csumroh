import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronDown,
  Clock3,
  ContactRound,
  ExternalLink,
  Layers,
  MapPin,
  MessageCircleMore,
  Phone,
  Search,
  ShieldCheck,
  Smartphone,
  UserRound,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useBrandScope } from '../../lib/scope';
import { useAuth } from '../../app/auth';
import { useUiStore } from '../../app/store';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { cn } from '../../lib/cn';

export type ContactDevice = {
  brandId: number;
  brandName: string;
  brandCode: string;
  devicePhone: string | null;
  sessionName: string;
  deviceStatus: 'connected' | 'disconnected' | 'connecting' | 'qr_ready';
  prospectId: number;
  remoteJid: string | null;
  messageCount: number;
  lastActiveAt: string | null;
  isCurrentBrand: boolean;
};

export type Contact = {
  id: number;
  brandId: number;
  name: string;
  phone: string | null;
  city: string | null;
  photoUrl?: string | null;
  leadSource: string;
  status: string;
  remoteJid: string | null;
  messageCount: number;
  user?: { id: number; name: string } | null;
  messages: Array<{ messageText: string | null; messageType: string; timestamp: number; isFromMe: boolean }>;
  devices: ContactDevice[];
  isMultiDevice: boolean;
  deviceCount: number;
  primaryDevice?: ContactDevice | null;
};

type DeviceItem = {
  brandId: number;
  brandName: string;
  brandCode: string;
  devicePhone: string | null;
  sessionName: string;
  deviceStatus: string;
  realContactCount: number;
  messageCount: number;
};

function formatPhoneDisplay(phone?: string | null): string {
  if (!phone) return '-';
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('62')) {
    return `+62 ${clean.slice(2, 5)}-${clean.slice(5, 9)}-${clean.slice(9)}`;
  }
  return phone;
}

function formatRelativeTime(timestampSeconds?: number | null): string {
  if (!timestampSeconds) return '-';
  const diffSec = Math.floor(Date.now() / 1000 - timestampSeconds);
  if (diffSec < 60) return 'Baru saja';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mnt lalu`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} jam lalu`;
  const d = new Date(timestampSeconds * 1000);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function ContactsPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const navigate = useNavigate();
  const setActiveBrandId = useUiStore((state) => state.setActiveBrandId);

  const [search, setSearch] = useState('');
  const [selectedDeviceBrandId, setSelectedDeviceBrandId] = useState<string>('all');
  const [onlyMultiDevice, setOnlyMultiDevice] = useState(false);

  const devicesQuery = useQuery({
    queryKey: ['contact-devices'],
    queryFn: () => api.get<DeviceItem[]>('/contacts/devices'),
  });

  const contacts = useQuery({
    queryKey: ['contacts', brandId, selectedDeviceBrandId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (brandId) params.set('brandId', String(brandId));
      if (selectedDeviceBrandId !== 'all') {
        params.set('deviceBrandId', selectedDeviceBrandId);
      } else {
        params.set('allDevices', 'true');
      }
      return api.get<Contact[]>(`/contacts?${params.toString()}`);
    },
    enabled: Boolean(brandId),
  });

  const filtered = useMemo(() => {
    let list = contacts.data ?? [];

    if (onlyMultiDevice) {
      list = list.filter((c) => c.isMultiDevice);
    }

    if (selectedDeviceBrandId !== 'all') {
      const targetBrandId = Number(selectedDeviceBrandId);
      list = list.filter((c) => c.devices?.some((d) => d.brandId === targetBrandId));
    }

    const needle = search.trim().toLowerCase();
    if (!needle) return list;

    return list.filter((contact) => {
      const deviceNames = (contact.devices ?? []).map((d) => `${d.brandName} ${d.devicePhone ?? ''}`).join(' ');
      return `${contact.name} ${contact.phone ?? ''} ${contact.city ?? ''} ${deviceNames}`
        .toLowerCase()
        .includes(needle);
    });
  }, [contacts.data, search, onlyMultiDevice, selectedDeviceBrandId]);

  const multiDeviceCount = useMemo(() => {
    return (contacts.data ?? []).filter((c) => c.isMultiDevice).length;
  }, [contacts.data]);



  function handleOpenInbox(contact: Contact, device?: ContactDevice | null) {
    const target = device || contact.devices?.[0] || {
      brandId: contact.brandId,
      prospectId: contact.id,
      remoteJid: contact.remoteJid,
    };
    setActiveBrandId(target.brandId);
    navigate(
      `/inbox?brandId=${target.brandId}&prospectId=${target.prospectId}&phone=${encodeURIComponent(
        contact.phone ?? ''
      )}&jid=${encodeURIComponent(target.remoteJid ?? contact.remoteJid ?? '')}`
    );
  }

  if (!brandId) {
    return (
      <PageError
        title="Belum ada brand aktif"
        description="Pilih brand untuk melihat daftar kontak WhatsApp riil yang terhubung."
      />
    );
  }

  if (contacts.isLoading) return <PageLoading label="Memuat kontak riil WhatsApp…" />;
  if (contacts.isError) return <PageError description={contacts.error.message} onRetry={() => void contacts.refetch()} />;

  return (
    <div className="app-page space-y-6">
      <PageHeader
        kicker="Buku Kontak Riil WhatsApp"
        kickerIcon={<ContactRound size={14} />}
        title="Daftar Kontak"
        subtitle="Format tabel kontak riil hasil interaksi WhatsApp terhubung. Menampilkan perangkat WhatsApp terhubung, status multi-device, dan riwayat chat."
      />

      {/* Summary Stat Cards */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Summary
          icon={Users}
          value={contacts.data?.length ?? 0}
          label="Total kontak riil WA"
          description="Semua kontak aktif yang punya riwayat chat"
        />
        <Summary
          icon={Layers}
          value={multiDeviceCount}
          label="Kontak multi-device"
          description="Terhubung ke >1 perangkat WA aktif"
          highlight={multiDeviceCount > 0}
        />
        <Summary
          icon={Smartphone}
          value={devicesQuery.data?.filter((d) => d.deviceStatus === 'connected').length ?? 1}
          label="Perangkat WA aktif"
          description="Sesi WhatsApp terhubung saat ini"
        />
      </section>

      {/* Table Section */}
      <section className="surface overflow-hidden">
        {/* Table Filters & Toolbar */}
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between flex-wrap bg-white">
          <div className="flex flex-1 items-center gap-2 min-w-[280px]">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-3 text-zinc-400" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="field pl-10"
                placeholder="Cari nama, nomor WA, device, atau kota…"
              />
            </div>

            {/* Quick Filter: Multi-Device only */}
            <button
              type="button"
              onClick={() => setOnlyMultiDevice((prev) => !prev)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer shrink-0',
                onlyMultiDevice
                  ? 'bg-amber-500 text-white border-amber-600 shadow-2xs'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
              )}
              title="Tampilkan hanya kontak yang terhubung ke lebih dari 1 device WhatsApp"
            >
              <Layers size={14} />
              <span>Multi-Device</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[10px]',
                  onlyMultiDevice ? 'bg-amber-600 text-white' : 'bg-zinc-100 text-zinc-600'
                )}
              >
                {multiDeviceCount}
              </span>
            </button>
          </div>

          {/* Device Filter Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">Filter Device:</span>
            <select
              value={selectedDeviceBrandId}
              onChange={(e) => setSelectedDeviceBrandId(e.target.value)}
              className="field h-9 text-xs font-medium py-1 px-2.5 rounded-xl cursor-pointer"
            >
              <option value="all">Semua Device WhatsApp</option>
              {(devicesQuery.data ?? []).map((dev, idx) => (
                <option key={`dev-${dev.brandId}-${idx}`} value={String(dev.brandId)}>
                  {dev.brandName} ({formatPhoneDisplay(dev.devicePhone)}) — {dev.realContactCount} kontak riil
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-400 shrink-0 ml-2">
              {filtered.length} kontak
            </p>
          </div>
        </div>

        {/* Contacts Table */}
        {filtered.length ? (
          <div className="overflow-x-auto thin-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="py-3.5 pl-6 pr-3">Kontak / Jamaah</th>
                  <th className="py-3.5 px-3">Device WhatsApp Terhubung</th>
                  <th className="py-3.5 px-3">Aktivitas & Riwayat Chat</th>
                  <th className="py-3.5 px-3">Status & PIC</th>
                  <th className="py-3.5 pl-3 pr-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {filtered.map((contact) => {
                  const latest = contact.messages[0];
                  const devices = contact.devices ?? [];
                  const isMultiDevice = contact.isMultiDevice;

                  return (
                    <tr
                      key={contact.id}
                      className="hover:bg-zinc-50/70 transition-colors group"
                    >
                      {/* Column 1: Contact Name & Identity */}
                      <td className="py-3.5 pl-6 pr-3 align-top">
                        <div className="flex items-start gap-3">
                          {contact.photoUrl ? (
                            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-black/5 bg-zinc-100 shadow-2xs mt-0.5">
                              <img
                                src={contact.photoUrl}
                                alt={contact.name}
                                className="h-full w-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            </div>
                          ) : (
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-extrabold text-zinc-600 shadow-2xs mt-0.5">
                              {contact.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-display font-bold text-sm text-zinc-900 leading-snug">
                                {contact.name}
                              </span>
                              {isMultiDevice && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.2 text-[9px] font-extrabold text-amber-800 border border-amber-200">
                                  <Layers size={10} />
                                  Multi-Device ({contact.deviceCount})
                                </span>
                              )}
                            </div>
                            <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500 font-medium">
                              <Phone size={12} className="text-zinc-400" />
                              <span>{formatPhoneDisplay(contact.phone)}</span>
                            </p>
                            {contact.city && (
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
                                <MapPin size={11} />
                                <span>{contact.city}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Connected WhatsApp Devices */}
                      <td className="py-3.5 px-3 align-top">
                        <div className="space-y-1.5 max-w-[280px]">
                          {devices.map((d) => (
                            <div
                              key={d.brandId}
                              onClick={() => handleOpenInbox(contact, d)}
                              className={cn(
                                'flex items-center justify-between gap-2 rounded-lg border p-1.5 text-xs transition cursor-pointer group/device',
                                d.isCurrentBrand
                                  ? 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/60'
                                  : 'border-zinc-200 bg-zinc-50/70 hover:bg-zinc-100'
                              )}
                              title={`Klik untuk buka chat di ${d.brandName}`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={cn(
                                    'h-2 w-2 rounded-full shrink-0',
                                    d.deviceStatus === 'connected' ? 'bg-emerald-500' : 'bg-zinc-300'
                                  )}
                                />
                                <span className="font-semibold text-zinc-800 truncate text-[11px] group-hover/device:text-emerald-700">
                                  {d.brandName}
                                </span>
                                <span className="text-[10px] text-zinc-500 truncate">
                                  ({formatPhoneDisplay(d.devicePhone)})
                                </span>
                              </div>
                              <span className="rounded bg-white px-1.5 py-0.2 text-[9px] font-bold text-zinc-600 border border-zinc-200/60 shrink-0">
                                {d.messageCount} chat
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Column 3: Message History & Last Activity */}
                      <td className="py-3.5 px-3 align-top">
                        <div className="max-w-xs space-y-1">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                            <Clock3 size={13} className="text-zinc-400" />
                            <span>{contact.messageCount} pesan tersimpan</span>
                            {latest?.timestamp && (
                              <span className="text-[10px] text-zinc-400 font-normal ml-1">
                                • {formatRelativeTime(latest.timestamp)}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] leading-relaxed text-zinc-500 line-clamp-2 italic bg-zinc-50 p-1.5 rounded-lg border border-zinc-100">
                            {latest
                              ? `${latest.isFromMe ? 'Anda: ' : ''}${
                                  latest.messageText || `[${latest.messageType}]`
                                }`
                              : 'Belum ada riwayat pesan.'}
                          </p>
                        </div>
                      </td>

                      {/* Column 4: Status & PIC */}
                      <td className="py-3.5 px-3 align-top">
                        <div className="space-y-1.5">
                          <Badge value={contact.status} className="text-[8.5px]" />
                          <p className="flex items-center gap-1 text-[11px] text-zinc-500">
                            <UserRound size={12} className="text-zinc-400" />
                            <span>PIC: {contact.user?.name || 'Belum ada'}</span>
                          </p>
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                            <ShieldCheck size={11} className="text-emerald-600" />
                            Riil WA
                          </span>
                        </div>
                      </td>

                      {/* Column 5: Actions */}
                      <td className="py-3.5 pl-3 pr-6 align-top text-right">
                        {isMultiDevice ? (
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <Button size="sm" variant="secondary" className="gap-1 text-xs">
                                <MessageCircleMore size={13} />
                                <span>Pilih Device</span>
                                <ChevronDown size={12} />
                              </Button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                align="end"
                                className="z-50 min-w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lift animate-fade-in text-left"
                              >
                                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                  Buka Chat di Perangkat:
                                </div>
                                {devices.map((d) => (
                                  <DropdownMenu.Item
                                    key={d.brandId}
                                    onClick={() => handleOpenInbox(contact, d)}
                                    className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 outline-none cursor-pointer"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Smartphone size={14} className="text-emerald-600 shrink-0" />
                                      <div className="truncate">
                                        <p className="leading-tight">{d.brandName}</p>
                                        <p className="text-[10px] font-normal text-zinc-500">
                                          {formatPhoneDisplay(d.devicePhone)}
                                        </p>
                                      </div>
                                    </div>
                                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-600 shrink-0">
                                      {d.messageCount} chat
                                    </span>
                                  </DropdownMenu.Item>
                                ))}
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleOpenInbox(contact, devices[0])}
                            className="gap-1.5 text-xs"
                          >
                            <MessageCircleMore size={13} />
                            <span>Buka chat</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10">
            <SectionEmpty
              title="Tidak ada kontak ditemukan"
              description={
                search || onlyMultiDevice || selectedDeviceBrandId !== 'all'
                  ? 'Tidak ada kontak yang cocok dengan kriteria filter saat ini.'
                  : 'Hanya kontak riil dari WhatsApp terhubung yang akan muncul di daftar ini.'
              }
            />
          </div>
        )}

        {/* Table Footer */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-3 text-xs text-zinc-500 bg-zinc-50/50">
            <span>
              Menampilkan <strong>{filtered.length}</strong> kontak riil terverifikasi
            </span>
            <span>
              {multiDeviceCount > 0 && (
                <span className="text-amber-700 font-semibold">
                  ⚡ {multiDeviceCount} kontak aktif di lebih dari 1 perangkat WhatsApp
                </span>
              )}
            </span>
          </div>
        )}
      </section>


    </div>
  );
}





function Summary({
  icon: Icon,
  value,
  label,
  description,
  highlight = false,
}: {
  icon: typeof Users;
  value: number;
  label: string;
  description?: string;
  highlight?: boolean;
}) {
  return (
    <article
      className={cn(
        'surface flex items-center gap-4 p-5 transition',
        highlight && 'border-amber-200 bg-amber-50/30'
      )}
    >
      <span
        className={cn(
          'grid h-11 w-11 place-items-center rounded-xl shadow-2xs shrink-0',
          highlight ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-700'
        )}
      >
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <p className="font-display text-2xl font-extrabold text-zinc-900 leading-tight">
          {value}
        </p>
        <p className="text-xs font-bold text-zinc-700 mt-0.5">{label}</p>
        {description && <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{description}</p>}
      </div>
    </article>
  );
}
