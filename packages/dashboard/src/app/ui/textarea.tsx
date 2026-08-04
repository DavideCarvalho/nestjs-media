import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/cn.js';

/**
 * A vendored shadcn-style textarea on the Aviary tokens, sharing the focus ring and border treatment
 * the Button and the console's filter boxes already use — so the SQL editor in the database preview
 * doesn't read as a stray browser control dropped into the panel.
 *
 * `code` is the only variant that exists because it is the only thing a textarea is for in this
 * console: typing a statement. It is monospaced and resizes vertically only — horizontal resize
 * would let it push out of the preview's flex column.
 */
export const textareaVariants = cva(
  'w-full rounded-md border border-border bg-black/30 p-2 text-zinc-300 placeholder:text-zinc-700 focus:border-accent/40 focus:outline-none disabled:opacity-50',
  {
    variants: {
      variant: {
        code: 'mono resize-y text-xs',
      },
    },
    defaultVariants: { variant: 'code' },
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, ...props }, ref) => (
    <textarea ref={ref} className={cn(textareaVariants({ variant }), className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
