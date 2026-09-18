import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './button';

type Props = {
  children: ReactNode;
  resetKey?: string;
  compact?: boolean;
};

type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI render failed', error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className={this.props.compact ? 'grid min-h-[60vh] place-items-center p-4' : 'grid min-h-screen place-items-center bg-zinc-50 p-4'}>
        <section className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-7 text-center shadow-soft sm:p-9" role="alert">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-zinc-950 text-white">
            <AlertTriangle size={21} aria-hidden="true" />
          </span>
          <h1 className="mt-5 font-display text-xl font-extrabold tracking-tight">Halaman gagal ditampilkan</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">
            Terjadi gangguan saat membuka menu ini. Data Anda tetap aman dan halaman dapat dicoba kembali.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button onClick={this.retry}><RefreshCw size={15} />Coba lagi</Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>Muat ulang aplikasi</Button>
          </div>
          {import.meta.env.DEV && <details className="mt-5 rounded-xl bg-zinc-50 p-3 text-left text-xs text-zinc-500"><summary className="cursor-pointer font-semibold">Detail teknis</summary><p className="mt-2 break-words font-mono">{this.state.error.message}</p></details>}
        </section>
      </div>
    );
  }
}
