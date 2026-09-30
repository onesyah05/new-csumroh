import { useState, useEffect, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Lock,
  Play,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import { SpamAudienceCard } from './SpamAudienceCard';
import { useAuth } from '../../app/auth';
import { useBrandScope } from '../../lib/scope';
import { useUiStore } from '../../app/store';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { Select } from '../../components/ui/select';
import { StatusBadge } from '../../components/ui/status-badge';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog, Modal } from '../../components/ui/modal';
import { Pager } from '../../components/ui/pager';

/* ─── Types ─────────────────────────────────────────────────── */
interface Brand {
  id: number;
  name: string;
  code: string;
}

interface MetaSettings {
  brandId: number;
  brandName: string;
  pixelId: string;
  facebookPageId: string;
  whatsappBusinessAccountId: string;
  adAccountId: string;
  testEventCode: string;
  accessTokenConfigured: boolean;
  maskedAccessToken?: string;
  adsAccessTokenConfigured?: boolean;
  connectionConfigured: boolean;
  ctwaReady: boolean;
  verifiedAt: string | null;
  lastError: string | null;
}

interface MetaLog {
  id: number;
  eventName: string;
  eventId: string;
  status: 'pending' | 'success' | 'failed';
  responseStatus: number | null;
  responseBody: string | null;
  payload?: string | null;
  createdAt: string;
  prospect: { id: number; name: string; phone?: string | null };
  /** Iklan asal prospek (nama dari tabel iklan tersimpan). */
  ad?: { adId: string; adName: string | null; campaignName: string | null } | null;
}

interface MetaLogPage {
  items: MetaLog[];
  total: number;
  page: number;
  pageSize: number;
  summary: { total: number; success: number; failed: number };
}

interface TestEventResponse {
  eventId: string;
  status: 'success' | 'failed';
  responseStatus?: number;
  responseBody?: string;
  payload?: unknown;
  testEventCode?: string | null;
  sourceProspect?: { id: number; name: string } | null;
}

const emptyForm = {
  pixelId: '',
  facebookPageId: '',
  whatsappBusinessAccountId: '',
  adAccountId: '',
  accessToken: '',
  adsAccessToken: '',
  testEventCode: '',
};

/* ─── Main Component ────────────────────────────────────────── */
/**
 * Meta CAPI per brand. Dipakai sebagai tab di detail Brand (`brandId` terkunci, tanpa judul & pemilih brand);
 * tanpa `brandId` menjadi halaman mandiri dengan pemilih brand.
 */
export function MetaCapiPage({ brandId: fixedBrandId }: { brandId?: number } = {}) {
  const embedded = fixedBrandId !== undefined;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { brandId: scopedId } = useBrandScope();
  const setActiveBrandId = useUiStore((s) => s.setActiveBrandId);

  // Brands query
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<Brand[]>('/catalog/brands'),
  });

  // Active brand selection
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [confirmTokenOpen, setConfirmTokenOpen] = useState(false);

  useEffect(() => {
    if (scopedId) {
      setSelectedBrandId(scopedId);
    } else if (brands.data && brands.data.length > 0 && !selectedBrandId) {
      const firstBrand = brands.data[0];
      if (firstBrand) setSelectedBrandId(firstBrand.id);
    }
  }, [scopedId, brands.data]);

  const currentBrandId = fixedBrandId ?? selectedBrandId ?? scopedId ?? (brands.data?.[0]?.id ?? 0);
  const currentBrand = brands.data?.find((b) => b.id === currentBrandId);

  // Meta Settings Query
  const settingsQuery = useQuery({
    queryKey: ['meta-settings', currentBrandId],
    queryFn: () => api.get<MetaSettings>(`/meta/settings?brandId=${currentBrandId}`),
    enabled: Boolean(currentBrandId),
  });

  // Search & Filter state for logs (diproses di server, per halaman)
  const [logSearch, setLogSearch] = useState('');
  const [logQ, setLogQ] = useState('');
  const [logEventFilter, setLogEventFilter] = useState<string>('all');
  const [logStatusFilter, setLogStatusFilter] = useState<string>('all');
  const [logPage, setLogPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => setLogQ(logSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [logSearch]);
  useEffect(() => setLogPage(1), [currentBrandId, logQ, logEventFilter, logStatusFilter]);

  // Meta Logs Query
  const logsQuery = useQuery({
    queryKey: ['meta-logs', currentBrandId, logQ, logEventFilter, logStatusFilter, logPage],
    queryFn: () => {
      const params = new URLSearchParams({ brandId: String(currentBrandId), search: logQ, event: logEventFilter, status: logStatusFilter, page: String(logPage), pageSize: '25' });
      return api.get<MetaLogPage>(`/meta/logs?${params}`);
    },
    enabled: Boolean(currentBrandId),
    placeholderData: keepPreviousData,
    refetchInterval: 15000,
  });

  // Tabs: 'settings' | 'logs' | 'funnel'
  const [activeTab, setActiveTab] = useState<'settings' | 'logs' | 'funnel'>('settings');

  // Form state
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);

  // Modals state
  const [selectedLog, setSelectedLog] = useState<MetaLog | null>(null);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testEventName, setTestEventName] = useState<'LeadSubmitted' | 'QualifiedLead' | 'AddToCart' | 'InitiateCheckout' | 'Purchase'>('Purchase');
  const [testEventCodeInput, setTestEventCodeInput] = useState('');
  const [testResult, setTestResult] = useState<TestEventResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyText(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  function showToast(msg: string) {
    showFeedback(msg);
  }

  // Populate form on settings load
  useEffect(() => {
    if (!settingsQuery.data) return;
    setForm({
      pixelId: settingsQuery.data.pixelId ?? '',
      facebookPageId: settingsQuery.data.facebookPageId ?? '',
      whatsappBusinessAccountId: settingsQuery.data.whatsappBusinessAccountId ?? '',
      adAccountId: settingsQuery.data.adAccountId ?? '',
      accessToken: '',
      adsAccessToken: '',
      testEventCode: settingsQuery.data.testEventCode ?? '',
    });
    setTestEventCodeInput(settingsQuery.data.testEventCode ?? '');
  }, [settingsQuery.data]);

  // Mutations
  const saveMutation = useMutation<MetaSettings, Error, boolean>({
    mutationFn: (clearAccessToken = false) =>
      api.put<MetaSettings>('/meta/settings', {
        brandId: currentBrandId,
        ...form,
        accessToken: form.accessToken || undefined,
        adsAccessToken: form.adsAccessToken || undefined,
        clearAccessToken,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['meta-settings', currentBrandId], data);
      setForm((cur) => ({ ...cur, accessToken: '', adsAccessToken: '' }));
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      showToast('Konfigurasi Meta CAPI berhasil disimpan.');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      api.post<{ connected: boolean; pixelName: string | null; verifiedAt: string; ctwaReady: boolean }>(
        '/meta/verify',
        { brandId: currentBrandId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['meta-settings', currentBrandId] });
      showToast('Verifikasi koneksi Meta Graph API berhasil!');
    },
  });

  const testEventMutation = useMutation<TestEventResponse, Error, void>({
    mutationFn: () =>
      api.post<TestEventResponse>('/meta/test-event', {
        brandId: currentBrandId,
        eventName: testEventName,
        testEventCode: testEventCodeInput.trim() || undefined,
      }),
    onSuccess: (res) => {
      setTestResult(res);
      void queryClient.invalidateQueries({ queryKey: ['meta-logs', currentBrandId] });
      showToast(res.status === 'success' ? 'Event uji coba berhasil dikirim ke Meta!' : 'Event uji coba gagal diproses Meta.');
    },
    onError: (error) => showToast(error.message),
  });

  // Event gagal juga dicoba ulang otomatis (berjeda); tombol ini untuk langsung setelah konfigurasi Meta dibetulkan.
  const resendMutation = useMutation<{ status: string; reason?: string }, Error, number>({
    mutationFn: (logId) => api.post(`/meta/logs/${logId}/resend`),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['meta-logs', currentBrandId] });
      showToast(res.status === 'sent' ? 'Event berhasil diterima Meta.' : res.status === 'skipped' ? 'Event tidak dikirim: sudah terkirim atau lebih dari 7 hari.' : 'Meta masih menolak event ini. Lihat Detail.');
    },
    onError: (error) => showToast(error.message),
  });
  const resendAllMutation = useMutation<{ total: number; sent: number; failed: number; skipped: number }, Error, void>({
    mutationFn: () => api.post('/meta/logs/resend-failed', { brandId: currentBrandId }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['meta-logs', currentBrandId] });
      showToast(res.total ? `${res.sent} dari ${res.total} event berhasil dikirim ulang${res.failed ? `, ${res.failed} masih ditolak Meta` : ''}.` : 'Tidak ada event gagal dalam 7 hari terakhir.');
    },
    onError: (error) => showToast(error.message),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(false);
  };

  const settings = settingsQuery.data;
  const logsPage = logsQuery.data;
  const filteredLogs = logsPage?.items ?? [];
  const logSummary = logsPage?.summary ?? { total: 0, success: 0, failed: 0 };

  if (brands.isLoading) return <PageLoading label="Memuat konfigurasi Meta CAPI…" />;
  if (brands.isError) return <PageError description={brands.error.message} onRetry={() => void brands.refetch()} />;

  const brandOptions = (brands.data ?? []).map((b) => ({
    value: String(b.id),
    label: b.name,
  }));

  return (
    <div className={embedded ? 'space-y-6' : 'app-page space-y-6 pb-16'}>

      {embedded ? (
        <div className="flex flex-wrap justify-end gap-2">
            {/* Quick Test Event Button */}
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                setTestResult(null);
                setTestModalOpen(true);
              }}
              icon={<Play size={13} className="text-zinc-600" />}
            >
              Uji Coba Event
            </Button>

            {/* Verify Connection Button */}
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={!settings?.connectionConfigured || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate()}
              loading={verifyMutation.isPending}
              icon={<RefreshCw size={13} />}
            >
              Tes Koneksi
            </Button>
        </div>
      ) : (
      <PageHeader
        title="Meta Conversions API"
        subtitle="Pelacakan konversi iklan dan event server-side."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Brand Switcher */}
            {(user?.role === 'superadmin' || (brands.data && brands.data.length > 1)) && (
              <Select
                value={String(currentBrandId)}
                onValueChange={(val) => {
                  const id = Number(val);
                  setSelectedBrandId(id);
                  setActiveBrandId(id);
                }}
                options={brandOptions}
                placeholder="Pilih Brand..."
                className="w-48"
              />
            )}

            {/* Quick Test Event Button */}
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                setTestResult(null);
                setTestModalOpen(true);
              }}
              icon={<Play size={13} className="text-zinc-600" />}
            >
              Uji Coba Event
            </Button>

            {/* Verify Connection Button */}
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={!settings?.connectionConfigured || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate()}
              loading={verifyMutation.isPending}
              icon={<RefreshCw size={13} />}
            >
              Tes Koneksi
            </Button>
          </div>
        }
      />
      )}

      {/* 4 Metric Stats Grid */}
      <StatGrid cols={4}>
        <StatCard
          label="Koneksi Pixel / Dataset"
          value={
            settings?.verifiedAt
              ? 'Terhubung'
              : settings?.connectionConfigured
              ? 'Terkonfigurasi'
              : 'Belum Diatur'
          }
          note={settings?.pixelId ? `ID: ${settings.pixelId}` : 'Pixel ID belum disimpan'}
          valueColor={
            settings?.verifiedAt
              ? 'text-emerald-700'
              : settings?.connectionConfigured
              ? 'text-amber-700'
              : 'text-zinc-500'
          }
        />
        <StatCard
          label="Tracking CTWA"
          value={settings?.ctwaReady ? 'Aktif' : 'Belum Lengkap'}
          note={settings?.ctwaReady ? 'Page ID tersimpan' : 'Lengkapi Facebook Page ID'}
          valueColor={settings?.ctwaReady ? 'text-emerald-700' : 'text-amber-700'}
        />
        <StatCard
          label="Access Token"
          value={settings?.accessTokenConfigured ? 'Tersimpan' : 'Belum Ada'}
          note={settings?.maskedAccessToken ? settings.maskedAccessToken : 'Terenkripsi AES-GCM'}
          valueColor={settings?.accessTokenConfigured ? 'text-zinc-950' : 'text-zinc-500'}
        />
        <StatCard
          label="Event Audit Terkirim"
          value={`${logSummary.total} Event`}
          note={`${logSummary.success} berhasil · ${logSummary.failed} gagal`}
        />
      </StatGrid>

      {/* Segmented Navigation Bar */}
      <div role="tablist" aria-label="Meta CAPI" className="scroll-row flex min-h-9 max-w-full w-fit items-stretch rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs">
        {[
          { id: 'settings', label: 'Konfigurasi & token', icon: KeyRound },
          { id: 'logs', label: `Log event (${logSummary.total})`, icon: Activity },
          { id: 'funnel', label: 'Alur & atribusi', icon: Layers },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-xs font-semibold transition cursor-pointer ${
                active
                  ? 'bg-zinc-950 text-white shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              <Icon size={13} className={active ? 'text-white' : 'text-zinc-500'} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: SETTINGS */}
      {activeTab === 'settings' && (
        <div className="max-w-4xl space-y-6">
          <Card className="p-6 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Section 1: Kredensial Meta & Dataset */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
                  <Radio size={16} className="text-zinc-600" />
                  <div>
                    <h3 className="text-xs font-extrabold text-zinc-700">
                      Kredensial Meta & Dataset · {currentBrand?.name ?? 'Brand'}
                    </h3>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="meta-pixel" className="label text-xs font-semibold">
                      Pixel / Dataset ID <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="meta-pixel"
                      type="text"
                      inputMode="numeric"
                      className="field"
                      value={form.pixelId}
                      onChange={(e) => setForm({ ...form, pixelId: e.target.value.replace(/\D/g, '') })}
                      placeholder="Contoh: 123456789012345"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="meta-page" className="label text-xs font-semibold">
                      Facebook Page ID
                    </label>
                    <input
                      id="meta-page"
                      type="text"
                      inputMode="numeric"
                      className="field"
                      value={form.facebookPageId}
                      onChange={(e) => setForm({ ...form, facebookPageId: e.target.value.replace(/\D/g, '') })}
                      placeholder="Contoh: 987654321012345"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="meta-waba" className="label text-xs font-semibold">
                      WhatsApp Business Account (WABA) ID (Opsional)
                    </label>
                    <input
                      id="meta-waba"
                      type="text"
                      inputMode="numeric"
                      className="field"
                      value={form.whatsappBusinessAccountId}
                      onChange={(e) => setForm({ ...form, whatsappBusinessAccountId: e.target.value.replace(/\D/g, '') })}
                      placeholder="Contoh: 543216789012345"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="meta-ad-account" className="label text-xs font-semibold">
                      Ad Account ID
                    </label>
                    <input
                      id="meta-ad-account"
                      type="text"
                      className="field"
                      value={form.adAccountId}
                      onChange={(e) => setForm({ ...form, adAccountId: e.target.value.trim().replace(/^act_/i, '').replace(/\D/g, '') })}
                      placeholder="Contoh: 1234567890 (tanpa act_)"
                      aria-describedby="meta-ad-account-hint"
                    />
                    <p id="meta-ad-account-hint" className="text-xs text-zinc-500">Untuk biaya & kreatif iklan di Laporan. Butuh Token Laporan Iklan (ads_read) di bawah.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="meta-test-code" className="label text-xs font-semibold">
                      Test Event Code (Opsional)
                    </label>
                    <input
                      id="meta-test-code"
                      type="text"
                      className="field font-mono"
                      value={form.testEventCode}
                      onChange={(e) => setForm({ ...form, testEventCode: e.target.value.trim().toUpperCase() })}
                      placeholder="TEST12345"
                      aria-describedby="meta-test-code-hint"
                    />
                    <p id="meta-test-code-hint" className="text-xs text-zinc-500">Hanya untuk tombol Uji Coba Event. Event dari prospek sungguhan tidak pernah memakai kode ini.</p>
                  </div>
                </div>
              </div>

              {/* Section 2: Access Token */}
              <div className="border-t border-zinc-100 pt-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
                  <KeyRound size={16} className="text-zinc-600" />
                  <div>
                    <h3 className="text-xs font-extrabold text-zinc-700">
                      Access Token Meta
                    </h3>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="meta-token" className="label font-semibold">
                      Token CAPI · kirim event <span className="text-rose-500">*</span>
                    </label>
                    {settings?.accessTokenConfigured && (
                      <span className="font-mono text-xs text-emerald-600 font-semibold flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        Token tersimpan terenkripsi
                      </span>
                    )}
                  </div>

                  <div className="relative flex gap-2">
                    <div className="relative flex-1">
                      <input
                        id="meta-token"
                        type={showPassword ? 'text' : 'password'}
                        className="field font-mono text-xs pr-10"
                        value={form.accessToken}
                        onChange={(e) => setForm({ ...form, accessToken: e.target.value.trim() })}
                        placeholder={
                          settings?.accessTokenConfigured
                            ? 'Token sudah tersimpan aman. Ketik baru jika ingin mengganti.'
                            : 'Tempel token dari Events Manager → dataset → Settings → Generate access token'
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 cursor-pointer p-0.5"
                        title={showPassword ? 'Sembunyikan token' : 'Lihat token'}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>

                    {settings?.accessTokenConfigured && (
                      <Button
                        type="button"
                        variant="danger"
                        size="md"
                        disabled={saveMutation.isPending}
                        onClick={() => setConfirmTokenOpen(true)}
                      >
                        Hapus Token
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="meta-ads-token" className="label font-semibold">
                      Token Laporan Iklan · ads_read (Opsional)
                    </label>
                    {settings?.adsAccessTokenConfigured && (
                      <span className="font-mono text-xs text-emerald-600 font-semibold flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        Token tersimpan terenkripsi
                      </span>
                    )}
                  </div>
                  <input
                    id="meta-ads-token"
                    type={showPassword ? 'text' : 'password'}
                    className="field font-mono text-xs"
                    value={form.adsAccessToken}
                    onChange={(e) => setForm({ ...form, adsAccessToken: e.target.value.trim() })}
                    aria-describedby="meta-ads-token-hint"
                    placeholder={
                      settings?.adsAccessTokenConfigured
                        ? 'Token sudah tersimpan aman. Ketik baru jika ingin mengganti.'
                        : 'Token System User dengan izin ads_read (dan ads_management untuk audiens spam)'
                    }
                  />
                  <p id="meta-ads-token-hint" className="text-xs text-zinc-500">
                    Untuk nama, biaya, dan gambar iklan di Laporan serta audiens spam. Token CAPI dari Events Manager tidak bisa membaca data iklan. Kosong = memakai token CAPI.
                  </p>
                </div>
              </div>

              {/* Alert: Last Error if present */}
              {settings?.lastError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-800">
                  <AlertCircle size={15} className="mt-0.5 text-rose-600 shrink-0" />
                  <div className="space-y-0.5">
                    <p className="font-semibold text-rose-900">Perhatian: Error Terakhir dari Meta</p>
                    <p className="font-mono text-xs text-rose-700 break-all">{settings.lastError}</p>
                  </div>
                </div>
              )}

              {/* Action Footer */}
              <div className="flex items-center justify-between border-t border-zinc-100 pt-5">
                <div className="text-xs text-zinc-500">
                  {settings?.verifiedAt ? (
                    <span className="text-emerald-600 font-medium">
                      Terakhir diverifikasi: {new Date(settings.verifiedAt).toLocaleString('id-ID')}
                    </span>
                  ) : (
                    <span>Konfigurasi disimpan terisolasi per-brand.</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={saveMutation.isPending}
                    disabled={saveMutation.isPending}
                  >
                    Simpan Konfigurasi CAPI
                  </Button>
                </div>
              </div>
            </form>
          </Card>
          {currentBrandId > 0 && <SpamAudienceCard brandId={currentBrandId} />}
        </div>
      )}

      {/* TAB 2: AUDIT LOGS (TABLE WITHOUT CARD WRAPPER) */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          {/* Filter Bar Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="contents">
              {/* Search */}
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-xs text-zinc-900 outline-none focus:border-black focus:ring-1 focus:ring-black transition placeholder:text-zinc-500 shadow-xs"
                  placeholder="Cari nama, nomor HP, atau event ID…"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                />
              </div>

              {/* Event Filter Pills */}
              <div className="scroll-row flex min-h-9 max-w-full items-stretch rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs">
                {['all', 'LeadSubmitted', 'QualifiedLead', 'AddToCart', 'InitiateCheckout', 'Purchase'].map((ev) => (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => setLogEventFilter(ev)}
                    className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-xs font-medium transition cursor-pointer ${
                      logEventFilter === ev
                        ? 'bg-zinc-950 text-white font-semibold shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    {ev === 'all' ? 'Semua event' : ev}
                  </button>
                ))}
              </div>

              {/* Status Filter Pills */}
              <div className="scroll-row flex min-h-9 max-w-full items-stretch rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs">
                {['all', 'success', 'failed'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setLogStatusFilter(st)}
                    className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-xs font-medium transition cursor-pointer ${
                      logStatusFilter === st
                        ? 'bg-zinc-950 text-white font-semibold shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    {st === 'all' ? 'Semua status' : st === 'success' ? 'Sukses' : 'Gagal'}
                  </button>
                ))}
              </div>
            </div>

            {logSummary.failed > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="ml-auto"
                onClick={() => resendAllMutation.mutate()}
                loading={resendAllMutation.isPending}
                icon={<Send size={13} />}
              >
                Kirim ulang yang gagal
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="md"
              className={logSummary.failed > 0 ? '' : 'ml-auto'}
              onClick={() => void logsQuery.refetch()}
              loading={logsQuery.isFetching}
              icon={<RefreshCw size={13} />}
            >
              Refresh Log
            </Button>
          </div>

          {/* Standard Independent Table Container (No Card Wrapper) */}
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {logsQuery.isLoading ? (
              <div className="py-16 text-center text-xs text-zinc-500">Memuat log audit Meta CAPI…</div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-16 text-center text-xs text-zinc-500">
                <Activity size={32} className="mx-auto mb-2 opacity-25" />
                <p className="font-bold text-zinc-700">Belum Ada Log Audit</p>
                <p className="mt-1 text-zinc-500">
                  {logSearch || logEventFilter !== 'all' || logStatusFilter !== 'all'
                    ? 'Tidak ada log event yang sesuai dengan filter pencarian.'
                    : 'Log akan tercatat secara otomatis saat prospek bergerak di pipeline atau saat event diuji.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* Di bawah lg kolom respons Meta disembunyikan; lengkap di modal detail log (tombol Aksi). */}
                <table className="w-full text-left text-xs lg:min-w-[760px]">
                  <thead className="border-b border-zinc-200 bg-zinc-50/75 text-xs font-semibold text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Event & Event ID</th>
                      <th className="px-4 py-3">Calon Jamaah</th>
                      <th className="hidden px-4 py-3 md:table-cell">Iklan</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="hidden px-4 py-3 lg:table-cell">Respons Meta Graph</th>
                      <th className="px-4 py-3">Waktu</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredLogs.map((log) => {
                      const isSuccess = log.status === 'success';
                      const isFailed = log.status === 'failed';

                      return (
                        <tr key={log.id} className="group hover:bg-zinc-50/60 transition-colors">
                          <td className="px-4 py-3.5">
                            <span className="font-bold text-xs text-zinc-950 block">{log.eventName}</span>
                            <span
                              className="font-mono text-xs text-zinc-500 block truncate max-w-[200px] mt-0.5"
                              title={log.eventId}
                            >
                              {log.eventId}
                            </span>
                          </td>

                          <td className="px-4 py-3.5">
                            <p className="font-bold text-xs text-zinc-900">{log.prospect?.name ?? '—'}</p>
                            {log.prospect?.phone && (
                              <p className="font-mono text-xs text-zinc-500 mt-0.5">{log.prospect.phone}</p>
                            )}
                          </td>

                          <td className="hidden px-4 py-3.5 md:table-cell">
                            {log.ad ? (
                              <>
                                <p className="max-w-[220px] truncate text-xs font-semibold text-zinc-900" title={log.ad.adName ?? log.ad.adId}>
                                  {log.ad.adName ?? `Iklan ${log.ad.adId}`}
                                </p>
                                {log.ad.campaignName && (
                                  <p className="mt-0.5 max-w-[220px] truncate text-xs text-zinc-500" title={log.ad.campaignName}>{log.ad.campaignName}</p>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-zinc-400">—</span>
                            )}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <StatusBadge
                              status={isSuccess ? 'active' : isFailed ? 'danger' : 'warning'}
                              label={isSuccess ? 'Sukses' : isFailed ? 'Gagal' : 'Pending'}
                              dot
                            />
                          </td>

                          <td className="hidden px-4 py-3.5 lg:table-cell">
                            <span className="font-mono font-bold text-xs text-zinc-800">
                              {log.responseStatus ? `HTTP ${log.responseStatus}` : '—'}
                            </span>
                            {log.responseBody && (
                              <p className="mt-0.5 max-w-[220px] truncate text-xs text-zinc-500" title={log.responseBody}>
                                {log.responseBody}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-3.5 text-zinc-500 whitespace-nowrap text-xs">
                            {new Date(log.createdAt).toLocaleString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>

                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {isFailed && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="mr-1.5"
                                onClick={() => resendMutation.mutate(log.id)}
                                loading={resendMutation.isPending && resendMutation.variables === log.id}
                                icon={<Send size={12} />}
                              >
                                Kirim ulang
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setSelectedLog(log)}
                              icon={<Eye size={12} />}
                            >
                              Detail
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {logsPage && <Pager page={logsPage.page} pageSize={logsPage.pageSize} total={logsPage.total} onPage={setLogPage} label="log event" />}
          </div>
        </div>
      )}

      {/* TAB 3: FUNNEL & ARCHITECTURE GUIDE */}
      {activeTab === 'funnel' && (
        <div className="space-y-6">
          {/* Funnel 4-Stage Cards Grid */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-zinc-950 font-display">Alur Konversi & Pelacakan Otomatis</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Pergerakan status prospek di CRM diterjemahkan menjadi event Meta Conversions API secara server-side:
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                {
                  step: '01',
                  event: 'LeadSubmitted',
                  trigger: 'Prospek Baru Masuk',
                  desc: 'Prospek mengirim pesan pertama via iklan CTWA. Server mengunci nomor HP dan ctwa_clid.',
                },
                {
                  step: '02',
                  event: 'QualifiedLead',
                  trigger: 'Terkualifikasi',
                  desc: 'Bulan keberangkatan dan jumlah jamaah terisi. Dikirim sekali; chat spam tidak pernah dikirim.',
                },
                {
                  step: '03',
                  event: 'AddToCart',
                  trigger: 'Penawaran Program',
                  desc: 'CS mengirimkan paket umroh ke prospek. Server mendispatch estimasi nilai paket ke Meta.',
                },
                {
                  step: '04',
                  event: 'InitiateCheckout',
                  trigger: 'Tahap Booking / DP',
                  desc: 'Prospek menyetujui booking dan diarahkan bayar DP. Mengirimkan nominal uang muka.',
                },
                {
                  step: '05',
                  event: 'Purchase',
                  trigger: 'Deal (diverifikasi Finance)',
                  desc: 'Prospek resmi terdaftar (Closed Won). Mengirimkan total nilai transaksi riil paket umroh.',
                },
              ].map((stage) => (
                <Card key={stage.step} className="p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                      <span className="font-mono text-xs font-bold text-zinc-500">TAHAP {stage.step}</span>
                      <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-bold text-zinc-800">
                        {stage.event}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-zinc-950">{stage.trigger}</h4>
                    <p className="text-xs text-zinc-500 leading-relaxed">{stage.desc}</p>
                  </div>
                  <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-xs font-medium text-zinc-600">
                    <span>Server-Side CAPI</span>
                    <ArrowRight size={12} className="text-zinc-500" />
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* 2 Proportional Technical Cards */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-5 space-y-3">
              <h4 className="text-xs font-bold text-zinc-950">
                Keunggulan Server-Side CAPI
              </h4>
              <ul className="space-y-2.5 text-xs leading-relaxed text-zinc-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span><strong>Bebas Ad-Blocker & Cookie Safari:</strong> Pengiriman langsung via backend menghindari pemblokiran skrip browser di sisi klien.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span><strong>Optimasi ROAS Iklan:</strong> Algoritma Meta menerima sinyal akurat mengenai prospek mana yang benar-benar membayar DP dan melunasi paket.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span><strong>Deduplikasi Event:</strong> ID deterministik (format <code>csumroh_prospect_*</code>) mencegah penggandaan data di Events Manager.</span>
                </li>
              </ul>
            </Card>

            <Card className="p-5 space-y-3">
              <h4 className="text-xs font-bold text-zinc-950">
                Standar Keamanan & Enkripsi
              </h4>
              <ul className="space-y-2.5 text-xs leading-relaxed text-zinc-600">
                <li className="flex items-start gap-2">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0 text-zinc-800" />
                  <span><strong>SHA-256 Hashing:</strong> Nomor telepon dinormalisasi ke format internasional E.164 (62xxx) dan di-hash SHA-256 sebelum dikirim.</span>
                </li>
                <li className="flex items-start gap-2">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0 text-zinc-800" />
                  <span><strong>Enkripsi AES-GCM:</strong> System User Access Token tersimpan aman di database dengan enkripsi kriptografis tingkat enterprise.</span>
                </li>
                <li className="flex items-start gap-2">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0 text-zinc-800" />
                  <span><strong>Log Audit Lengkap:</strong> Setiap dispatch mencatat status HTTP dan respon dari Meta untuk kemudahan monitoring dan troubleshooting.</span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL LOG AUDIT */}
      <Modal
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        size="xl"
        title={selectedLog?.eventName ?? 'Detail event'}
        description="Audit detail event Meta CAPI"
        footer={<Button variant="secondary" size="sm" onClick={() => setSelectedLog(null)}>Tutup</Button>}
      >
            {selectedLog && (
              <div className="space-y-5">

                {/* 4-Item Grid Info */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 space-y-0.5">
                    <span className="text-xs font-bold text-zinc-500">Event ID</span>
                    <p className="font-mono font-bold text-zinc-900 break-all">{selectedLog.eventId}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 space-y-0.5">
                    <span className="text-xs font-bold text-zinc-500">Calon Jamaah</span>
                    <p className="font-bold text-zinc-900">{selectedLog.prospect?.name ?? '—'}</p>
                    <p className="font-mono text-xs text-zinc-500">{selectedLog.prospect?.phone ?? '-'}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 space-y-0.5">
                    <span className="text-xs font-bold text-zinc-500">Status & Respon</span>
                    <p className="font-bold capitalize text-zinc-900">
                      {selectedLog.status} ({selectedLog.responseStatus ? `HTTP ${selectedLog.responseStatus}` : 'No Response'})
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 space-y-0.5">
                    <span className="text-xs font-bold text-zinc-500">Waktu Dispatch</span>
                    <p className="font-bold text-zinc-900">{new Date(selectedLog.createdAt).toLocaleString('id-ID')}</p>
                  </div>
                </div>

                {/* Payload JSON */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-700">Payload Terkirim ke Meta</span>
                    {selectedLog.payload && (
                      <button
                        type="button"
                        onClick={() => copyText('payload', selectedLog.payload!)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-950 cursor-pointer"
                      >
                        {copiedKey === 'payload' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        {copiedKey === 'payload' ? 'Tersalin' : 'Salin JSON'}
                      </button>
                    )}
                  </div>
                  <pre className="max-h-40 overflow-y-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs text-emerald-400 border border-zinc-900">
                    {selectedLog.payload
                      ? (() => {
                          try {
                            return JSON.stringify(JSON.parse(selectedLog.payload), null, 2);
                          } catch {
                            return selectedLog.payload;
                          }
                        })()
                      : '// Payload tidak tersedia'}
                  </pre>
                </div>

                {/* Meta Response */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-700">Respons Meta Graph API</span>
                    {selectedLog.responseBody && (
                      <button
                        type="button"
                        onClick={() => copyText('response', selectedLog.responseBody!)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-950 cursor-pointer"
                      >
                        {copiedKey === 'response' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        {copiedKey === 'response' ? 'Tersalin' : 'Salin Respons'}
                      </button>
                    )}
                  </div>
                  <pre className="max-h-40 overflow-y-auto rounded-xl bg-zinc-900 p-3 font-mono text-xs text-zinc-300 border border-zinc-800">
                    {selectedLog.responseBody
                      ? (() => {
                          try {
                            return JSON.stringify(JSON.parse(selectedLog.responseBody), null, 2);
                          } catch {
                            return selectedLog.responseBody;
                          }
                        })()
                      : '// Tidak ada data respons'}
                  </pre>
                </div>

              </div>
            )}
      </Modal>

      <ConfirmDialog
        open={confirmTokenOpen}
        onClose={() => setConfirmTokenOpen(false)}
        onConfirm={() => saveMutation.mutate(true, { onSettled: () => setConfirmTokenOpen(false) })}
        pending={saveMutation.isPending}
        title="Hapus access token?"
        description="Token Meta tersimpan untuk brand ini dihapus. Event konversi tidak terkirim sampai token baru dimasukkan."
        confirmLabel="Hapus token"
      />

      {/* MODAL: TEST EVENT SANDBOX */}
      <Modal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        size="lg"
        title="Kirim event uji coba Meta CAPI"
        description="Memakai klik iklan asli terakhir di brand ini dan Test Event Code, jadi tidak dihitung sebagai konversi nyata."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTestModalOpen(false)}>Tutup</Button>
            <Button
              size="sm"
              disabled={testEventMutation.isPending || !settings?.connectionConfigured}
              loading={testEventMutation.isPending}
              onClick={() => testEventMutation.mutate()}
              icon={<Send size={13} />}
            >
              Kirim Sekarang
            </Button>
          </>
        }
      >

            <div className="space-y-4">

              <div className="space-y-1.5">
                <label className="label text-xs font-semibold">Pilih Jenis Event</label>
                <Select
                  value={testEventName}
                  onValueChange={(val) => setTestEventName(val as typeof testEventName)}
                  options={[
                    { value: 'LeadSubmitted', label: 'LeadSubmitted (Prospek Baru)' },
                    { value: 'QualifiedLead', label: 'QualifiedLead (Terkualifikasi)' },
                    { value: 'AddToCart', label: 'AddToCart (Penawaran Program)' },
                    { value: 'InitiateCheckout', label: 'InitiateCheckout (Booking / DP)' },
                    { value: 'Purchase', label: 'Purchase (Deal)' },
                  ]}
                />
              </div>

              <div className="space-y-1.5">
                <label className="label text-xs font-semibold">Test Event Code (Dari Events Manager)</label>
                <input
                  type="text"
                  value={testEventCodeInput}
                  onChange={(e) => setTestEventCodeInput(e.target.value.trim().toUpperCase())}
                  placeholder="Contoh: TEST12345"
                  className="field font-mono uppercase"
                />
                <p className="text-xs text-zinc-500">
                  Dapatkan kode ini dari tab <strong>Test Events</strong> di Meta Events Manager agar event muncul langsung.
                </p>
              </div>

              {testResult && (
                <div
                  className={`rounded-xl border p-3.5 text-xs space-y-1 ${
                    testResult.status === 'success'
                      ? 'border-emerald-200 bg-emerald-50/90 text-emerald-950'
                      : 'border-rose-200 bg-rose-50/90 text-rose-950'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    {testResult.status === 'success' ? (
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle size={15} className="text-rose-600 shrink-0" />
                    )}
                    <span>
                      {testResult.status === 'success' ? 'Event Diterima Meta (200 OK)' : 'Meta Menolak Event'}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-zinc-600">Event ID: {testResult.eventId}</p>
                  {testResult.sourceProspect && (
                    <p className="text-xs text-zinc-600">Memakai klik iklan asli dari prospek {testResult.sourceProspect.name}.</p>
                  )}
                  {testResult.responseBody && (
                    <pre className="mt-1.5 max-h-28 overflow-y-auto rounded-lg bg-black/10 p-2 font-mono text-xs">
                      {testResult.responseBody}
                    </pre>
                  )}
                </div>
              )}

            </div>
      </Modal>
    </div>
  );
}
