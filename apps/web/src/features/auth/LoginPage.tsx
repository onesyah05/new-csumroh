import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { Button } from '../../components/ui/button';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_.95fr]">
      {/* Left Branding Showcase */}
      <section className="relative hidden overflow-hidden bg-zinc-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="noise absolute inset-0 opacity-70" />
        <div className="absolute -right-32 top-24 h-80 w-80 rounded-full border border-zinc-800" />
        <div className="absolute -right-16 top-40 h-56 w-56 rounded-full border border-zinc-700" />

        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white font-sans text-sm font-extrabold text-black shadow-sm">
            AZ
          </span>
          <div>
            <b className="font-sans text-sm tracking-tight">CRM AZHAN</b>
            <p className="text-[10px] uppercase tracking-[.2em] text-zinc-400">Conversion Desk</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300">
            <Sparkles size={13} className="text-zinc-400" />
            <span>Dibangun untuk tim travel modern</span>
          </div>
          <h1 className="font-sans text-4xl sm:text-5xl font-extrabold leading-[1.1] tracking-tight">
            Setiap percakapan,<br />
            <span className="text-zinc-500">lebih dekat ke Baitullah.</span>
          </h1>
          <p className="mt-5 max-w-lg text-sm sm:text-base leading-relaxed text-zinc-400">
            Satu ruang kerja untuk melayani jamaah, menjaga pipeline tetap rapi, dan membantu setiap CS menjawab dengan tepat dan amanah.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              [MessagesSquare, 'Shared Inbox'],
              [ShieldCheck, 'Brand Terisolasi'],
              [Check, 'Alur Terukur'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Check;
              return (
                <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-xs">
                  <I size={18} className="mb-3 text-zinc-300" />
                  <p className="text-xs font-semibold text-zinc-300">{String(label)}</p>
                </div>
              );
            })}
          </div>
        </div>

        <p className="relative text-xs text-zinc-600">
          © {new Date().getFullYear()} CRM AZHAN. Sistem operasional travel internal.
        </p>
      </section>

      {/* Right Login Form */}
      <section className="flex min-h-screen items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[380px] animate-fade-up">
          <div className="mb-8 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-950 font-sans text-sm font-extrabold text-white shadow-xs">
              AZ
            </span>
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Selamat datang kembali
          </p>
          <h2 className="font-sans text-2xl sm:text-3xl font-bold tracking-tight text-zinc-950">
            Masuk ke workspace
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500">
            Gunakan akun yang diberikan administrator brand Anda.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label text-xs font-medium" htmlFor="email">
                Email kerja
              </label>
              <input
                id="email"
                className="field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@travel.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="label text-xs font-medium" htmlFor="password">
                Kata sandi
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="field pr-10 font-mono"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition"
                  aria-label="Tampilkan kata sandi"
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 shadow-2xs">
                {error}
              </div>
            )}

            <Button className="w-full" disabled={busy}>
              <span>{busy ? 'Memeriksa akun…' : 'Masuk ke workspace'}</span>
              {!busy && <ArrowRight size={14} />}
            </Button>
          </form>

          <div className="mt-6 flex items-center gap-2 border-t border-zinc-200/90 pt-4 text-xs text-zinc-400">
            <LockKeyhole size={13} className="text-zinc-500" />
            <span>Akses terenkripsi dan terisolasi per brand.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
