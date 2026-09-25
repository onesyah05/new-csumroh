import { cn } from '../../lib/cn';
import { customSpecGroups, type CustomBasePackage, type CustomRequest } from './customApi';

/** Rincian kebutuhan jamaah per kelompok (Perjalanan, Jamaah, Hotel & malam, Layanan, Budget & catatan). */
export function CustomSpecGroups({ request, basePackage, compact = false, className }: {
  request: CustomRequest; basePackage?: CustomBasePackage | null; compact?: boolean; className?: string;
}) {
  const groups = customSpecGroups(request, basePackage === undefined ? request.basePackage ?? null : basePackage);
  return <div className={cn(compact ? 'space-y-2.5' : 'grid gap-x-8 gap-y-4 md:grid-cols-2', className)}>
    {groups.map((group) => <section key={group.title} aria-label={group.title} className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{group.title}</h4>
      <dl className="space-y-0.5 text-xs">
        {group.rows.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3 border-b border-zinc-100 py-1 last:border-b-0">
          <dt className="shrink-0 text-zinc-600">{label}</dt>
          <dd className="min-w-0 whitespace-pre-line text-right font-medium text-zinc-900">{value}</dd>
        </div>)}
      </dl>
    </section>)}
  </div>;
}
