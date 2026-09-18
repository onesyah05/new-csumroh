import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { Button } from '../../components/ui/button';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await login(email, password); } catch (err) { setError(err instanceof Error ? err.message : 'Login gagal.'); } finally { setBusy(false); } }
  return <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden bg-zinc-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="noise absolute inset-0 opacity-70" /><div className="absolute -right-32 top-24 h-80 w-80 rounded-full border border-zinc-800" /><div className="absolute -right-16 top-40 h-56 w-56 rounded-full border border-zinc-700" />
      <div className="relative flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-white font-display text-sm font-extrabold text-black">CU</span><div><b className="font-display tracking-tight">CS Umroh</b><p className="text-[10px] uppercase tracking-[.2em] text-zinc-500">Conversion desk</p></div></div>
      <div className="relative max-w-xl"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300"><Sparkles size={13} />Dibangun untuk tim travel modern</div><h1 className="font-display text-5xl font-extrabold leading-[1.08] tracking-[-.05em]">Setiap percakapan,<br /><span className="text-zinc-500">lebih dekat ke Baitullah.</span></h1><p className="mt-6 max-w-lg text-base leading-7 text-zinc-400">Satu ruang kerja untuk melayani jamaah, menjaga pipeline tetap rapi, dan membantu setiap CS menjawab dengan tepat.</p>
        <div className="mt-10 grid grid-cols-3 gap-3">{[[MessagesSquare,'Shared inbox'],[ShieldCheck,'Brand aman'],[Check,'Alur terukur']].map(([Icon,label]) => { const I = Icon as typeof Check; return <div key={String(label)} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"><I size={19} className="mb-4 text-zinc-300" /><p className="text-xs font-semibold text-zinc-300">{String(label)}</p></div>; })}</div>
      </div><p className="relative text-xs text-zinc-600">© 2026 CS Umroh. Sistem operasional internal.</p>
    </section>
    <section className="flex min-h-screen items-center justify-center p-6 sm:p-10"><div className="w-full max-w-[420px] animate-fade-up">
      <div className="mb-9 lg:hidden"><span className="grid h-11 w-11 place-items-center rounded-xl bg-zinc-950 font-display text-sm font-extrabold text-white">CU</span></div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[.16em] text-zinc-400">Selamat datang kembali</p><h2 className="font-display text-3xl font-extrabold tracking-[-.04em]">Masuk ke workspace</h2><p className="mt-2 text-sm leading-6 text-zinc-500">Gunakan akun yang diberikan administrator brand Anda.</p>
      <form onSubmit={submit} className="mt-8 space-y-5"><div><label className="label" htmlFor="email">Email kerja</label><input id="email" className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@travel.com" autoComplete="email" required /></div><div><label className="label" htmlFor="password">Kata sandi</label><div className="relative"><input id="password" className="field pr-12" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 8 karakter" autoComplete="current-password" required minLength={8} /><button type="button" onClick={() => setShow(!show)} className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Tampilkan kata sandi">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
        {error && <div className="rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-2.5 text-sm text-zinc-700">{error}</div>}
        <Button className="w-full" disabled={busy}>{busy ? 'Memeriksa akun…' : 'Masuk ke workspace'}{!busy && <ArrowRight size={16} />}</Button>
      </form><div className="mt-8 flex items-center gap-2 border-t pt-5 text-xs text-zinc-400"><LockKeyhole size={14} />Akses terenkripsi dan terisolasi per brand.</div>
    </div></section>
  </main>;
}
