import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export type SelectOption = { value: string; label: string };
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
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="text-zinc-400 shrink-0">
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
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
