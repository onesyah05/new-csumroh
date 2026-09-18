import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'icon' }>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => <button ref={ref} className={cn('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50', { 'bg-zinc-950 text-white hover:bg-zinc-800': variant === 'primary', 'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100': variant === 'secondary', 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950': variant === 'ghost', 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300': variant === 'danger', 'h-9 px-3 text-xs': size === 'sm', 'h-11 px-4 text-sm': size === 'md', 'h-10 w-10': size === 'icon' }, className)} {...props} />,
);
Button.displayName = 'Button';
