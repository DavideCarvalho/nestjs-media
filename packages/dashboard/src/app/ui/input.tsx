import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/cn.js';

/**
 * A vendored shadcn-style input on the Aviary tokens, sharing the Button's border and focus ring.
 *
 * `field` is the ordinary labelled box (sign-in, rename, new folder); `inline` is the chromeless
 * variant the data grid uses for its per-column filters, where a full border on every column would
 * turn a table header into a wall of boxes.
 */
export const inputVariants = cva(
  'w-full bg-transparent text-fg-2 placeholder:text-faint focus:border-brand-border focus:outline-none disabled:opacity-50',
  {
    variants: {
      variant: {
        field: 'mono rounded-md border border-border bg-sunken/30 px-2 py-1.5 text-xs',
        inline:
          'mono rounded border border-border px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal',
      },
    },
    defaultVariants: { variant: 'field' },
  },
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, ...props }, ref) => (
    <input ref={ref} className={cn(inputVariants({ variant }), className)} {...props} />
  ),
);
Input.displayName = 'Input';
