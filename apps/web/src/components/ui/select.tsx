import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export type SelectOption = { value: string; label: string };
export function Select({ value, onValueChange, options, placeholder, className }: { value?: string; onValueChange(value: string): void; options: SelectOption[]; placeholder?: string; className?: string }) {
  return <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
    <SelectPrimitive.Trigger className={cn('flex h-10 min-w-[150px] items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none hover:border-zinc-400 focus:ring-2 focus:ring-zinc-900', className)}>
      <SelectPrimitive.Value placeholder={placeholder} /><SelectPrimitive.Icon><ChevronDown size={15} /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal><SelectPrimitive.Content position="popper" sideOffset={6} className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lift">
      <SelectPrimitive.Viewport>{options.map((option) => <SelectPrimitive.Item key={option.value} value={option.value} className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm text-zinc-700 outline-none data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-950"><SelectPrimitive.ItemIndicator className="absolute left-2"><Check size={14} /></SelectPrimitive.ItemIndicator><SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText></SelectPrimitive.Item>)}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
