import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert } from './ui/alert.js';
import { Button } from './ui/button.js';
import {
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from './ui/dialog.js';

/** Console-specific surface primitives for the media console, built on the vendored shadcn
 *  primitives in `./ui/` so they inherit the Aviary tokens: a dark panel, a status dot, a modal,
 *  a toast stack, and the byte/date/age formatters every view reuses. Keeping these in one place is
 *  what keeps the three views identical in feel.
 *
 *  `Button` and `Alert` are re-exported here so a view has one import path for the whole kit. */

export { Button, Alert };
export type { ButtonProps } from './ui/button.js';

export type Tone = 'ok' | 'live' | 'warn' | 'error' | 'info' | 'idle';

/** A 7px status pip in the tone's hue (see `.s-*` in styles.css), optionally pulsing for live state. */
export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }): JSX.Element {
  return <span className={`dot s-${tone} ${pulse ? 'pulse' : ''}`} aria-hidden />;
}

/** The dark card container — a bordered panel over the blueprint backdrop. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={`rounded-lg border border-border bg-panel ${className}`}>{children}</div>;
}

/** Centered muted message for empty / loading / error panes. */
export function Notice({ children }: { children: ReactNode }): JSX.Element {
  return <Alert variant="muted">{children}</Alert>;
}

/**
 * A themed modal dialog on the vendored shadcn/Base UI Dialog (see `./ui/dialog.tsx`). The focus
 * trap, focus restore, scroll lock, `aria-modal` wiring and Esc / outside-press dismissal come from
 * the primitive. Optional `footer` pins actions to the bottom; `initialFocus` picks the field that
 * should be focused (and, for a text input, selected) once it opens.
 *
 * Mounted-means-open: every caller renders this conditionally, so `open` is constant and closing is
 * reported through `onClose`, which unmounts it.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  initialFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
}): JSX.Element {
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          // Select-on-open rather than just focus-on-open: a rename/copy dialog opens with the
          // current name in the field, and the point is to be able to type straight over it.
          initialFocus={() => {
            const element = initialFocus?.current;
            if (element instanceof HTMLInputElement) element.select();
            return element ?? true;
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <DialogTitle>{title}</DialogTitle>
            <Button render={<DialogClose />} tone="ghost" aria-label="Close" className="shrink-0">
              ✕
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
          )}
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}

/** A transient corner notification — the console's answer to `window.alert`, so a failed (or
 *  succeeded) action reports without a blocking browser dialog. Success auto-dismisses quickly; an
 *  error lingers longer and can be dismissed by hand. */
export type ToastTone = 'ok' | 'error';
export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

/** Owns the live toast list. `pushToast` enqueues one (returns nothing — fire and forget from any
 *  handler); `dismissToast` drops it early. Ids come from a monotonic ref so they never collide. */
export function useToasts(): {
  toasts: Toast[];
  pushToast: (tone: ToastTone, text: string) => void;
  dismissToast: (id: number) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const pushToast = useCallback((tone: ToastTone, text: string): void => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { id, tone, text }]);
  }, []);
  const dismissToast = useCallback((id: number): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  return { toasts, pushToast, dismissToast };
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(
      () => onDismiss(toast.id),
      toast.tone === 'error' ? 6000 : 3500,
    );
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);
  return (
    <div
      className={`rise mono flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] shadow-2xl backdrop-blur-sm ${
        toast.tone === 'error'
          ? 'border-bad/40 bg-bad/15 text-bad'
          : 'border-accent/40 bg-accent/15 text-accent'
      }`}
    >
      <span className="mt-px shrink-0" aria-hidden>
        {toast.tone === 'error' ? '✕' : '✓'}
      </span>
      <span className="flex-1 break-words normal-case">{toast.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

/** Renders the live toasts stacked in the bottom-right, over everything (including modals). */
export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}): JSX.Element | null {
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

const BYTE_UNITS: ReadonlyArray<string> = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const unit = BYTE_UNITS[exponent] ?? 'B';
  return exponent === 0 ? `${value} ${unit}` : `${value.toFixed(1)} ${unit}`;
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

/** Compact "Nm ago" relative stamp; undefined when the timestamp is missing or unparseable. */
export function relativeAge(createdAt: string | undefined): string | undefined {
  if (!createdAt) return undefined;
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return undefined;
  const seconds = Math.max(0, Math.floor((Date.now() - createdMs) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
