import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  kicker?: ReactNode;
  kickerIcon?: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  backUrl?: string;
  onBack?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  kicker,
  kickerIcon,
  subtitle,
  badges,
  backUrl,
  onBack,
  actions,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backUrl) {
      navigate(backUrl);
    } else {
      navigate(-1);
    }
  };

  const showBackButton = Boolean(onBack || backUrl);

  return (
    <section className={cn('page-header flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {showBackButton && (
          <button
            type="button"
            onClick={handleBack}
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-xs hover:bg-zinc-50 hover:text-zinc-900 transition cursor-pointer"
            aria-label="Kembali"
          >
            <ArrowLeft size={16} />
          </button>
        )}

        <div className="space-y-1 min-w-0">
          {kicker && (
            <p className="page-kicker flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
              {kickerIcon && <span className="shrink-0 text-zinc-500">{kickerIcon}</span>}
              <span>{kicker}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-950 sm:text-2xl tracking-tight leading-tight">
              {title}
            </h1>
            {badges && <div className="flex items-center gap-1.5 flex-wrap">{badges}</div>}
          </div>

          {subtitle && (
            <p className="text-xs text-zinc-500 leading-relaxed max-w-3xl">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex items-center gap-2 self-start shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </section>
  );
}
