import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { resolveMediaUrl } from '../../lib/api';

export type SelectOption = { value: string; label: string; iconUrl?: string | null; iconInitials?: string | null };
export type SelectSize = 'sm' | 'md' | 'lg';

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = 'md',
  disabled,
  'aria-label': ariaLabel,
}: {
  value?: string;
  onValueChange(value: string): void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: SelectSize;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const isCompact = size === 'sm' || size === 'md' || className?.includes('text-xs') || className?.includes('h-9') || className?.includes('h-8');
  const selectedOption = options.find(o => o.value === value);

  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex items-center justify-between gap-2 border border-zinc-200 bg-white text-zinc-800 outline-none hover:border-zinc-300 focus:ring-1 focus:ring-zinc-950 transition select-none whitespace-nowrap shadow-xs [&>span]:truncate',
          {
            'h-8 px-2.5 text-xs rounded-lg': size === 'sm',
            'h-9 px-3 text-xs font-medium rounded-xl': size === 'md',
            'h-10 px-3.5 text-sm rounded-xl': size === 'lg',
          },
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder}>
          {selectedOption && (selectedOption.iconUrl || selectedOption.iconInitials) ? (
            <div className="flex items-center gap-2">
              {selectedOption.iconUrl ? (
                <img src={resolveMediaUrl(selectedOption.iconUrl)} alt="" className={cn("shrink-0 rounded-md object-cover border border-zinc-200", isCompact ? "h-5 w-5" : "h-6 w-6")} />
              ) : selectedOption.iconInitials ? (
                <span className={cn("grid shrink-0 place-items-center rounded-md bg-zinc-200 font-bold text-zinc-700", isCompact ? "h-5 w-5 text-xs" : "h-6 w-6 text-xs")}>
                  {selectedOption.iconInitials}
                </span>
              ) : null}
              <span className="truncate">{selectedOption.label}</span>
            </div>
          ) : undefined}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="text-zinc-500 shrink-0">
          <ChevronDown size={isCompact ? 13 : 15} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lift animate-in fade-in-0 zoom-in-95"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'relative flex cursor-pointer select-none items-center rounded-lg text-zinc-700 outline-none transition-colors data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-950',
                  isCompact ? 'py-1.5 pl-6 pr-2.5 text-xs font-medium' : 'py-2 pl-8 pr-3 text-sm'
                )}
              >
                <SelectPrimitive.ItemIndicator className={cn('absolute flex items-center justify-center text-zinc-900', isCompact ? 'left-1.5' : 'left-2')}>
                  <Check size={isCompact ? 12 : 14} strokeWidth={2.5} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>
                  {option.iconUrl || option.iconInitials ? (
                    <div className="flex items-center gap-2">
                      {option.iconUrl ? (
                        <img src={resolveMediaUrl(option.iconUrl)} alt="" className={cn("shrink-0 rounded-md object-cover border border-zinc-200 bg-white", isCompact ? "h-5 w-5" : "h-6 w-6")} />
                      ) : option.iconInitials ? (
                        <span className={cn("grid shrink-0 place-items-center rounded-md bg-zinc-200 font-bold text-zinc-700", isCompact ? "h-5 w-5 text-xs" : "h-6 w-6 text-xs")}>
                          {option.iconInitials}
                        </span>
                      ) : null}
                      <span className="truncate">{option.label}</span>
                    </div>
                  ) : (
                    option.label
                  )}
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
