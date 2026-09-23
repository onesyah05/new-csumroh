import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  asChild?: boolean;
  to?: string;
  href?: string;
}

export function buttonVariants({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-all select-none cursor-pointer',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
    {
      // Variants
      'bg-zinc-950 text-white hover:bg-zinc-800 border border-zinc-950 shadow-xs': variant === 'primary',
      'border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 hover:border-zinc-300 shadow-xs': variant === 'secondary',
      'border border-zinc-200 bg-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950': variant === 'outline',
      'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950': variant === 'ghost',
      'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-300 shadow-xs': variant === 'danger',
      'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 shadow-xs': variant === 'success',

      // Sizes
      'h-8 px-2.5 text-xs rounded-lg': size === 'sm',
      'h-9 px-3.5 text-xs rounded-xl': size === 'md',
      'h-10 px-4 text-sm rounded-xl': size === 'lg',
      'h-9 w-9 rounded-xl p-0 shrink-0': size === 'icon',
    },
    className
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      icon,
      asChild = false,
      to,
      href,
      children,
      ...props
    },
    ref
  ) => {
    const classes = buttonVariants({ variant, size, className });

    const content = (
      <>
        {loading ? (
          <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin shrink-0" />
        ) : (
          icon && <span className="shrink-0 flex items-center">{icon}</span>
        )}
        {children}
      </>
    );

    // If to is passed, render React Router Link directly
    if (to) {
      return (
        <Link to={to} className={classes} {...(props as any)}>
          {content}
        </Link>
      );
    }

    // If href is passed, render standard anchor
    if (href) {
      return (
        <a href={href} className={classes} {...(props as any)}>
          {content}
        </a>
      );
    }

    // If asChild is true, use Radix Slot
    if (asChild) {
      return (
        <Slot ref={ref as any} className={classes} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={classes}
        {...props}
      >
        {content}
      </button>
    );
  }
);
Button.displayName = 'Button';
