import type { ReactNode } from 'react';

/** Shared surface primitives for the media console, mirroring the durable console's design system:
 *  a dark panel, an emerald-accented status dot, ghost action buttons, and the byte/date/age
 *  formatters every view reuses. Keeping these in one place is what keeps the three views identical
 *  in feel. */

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
  return (
    <div className={`rounded-lg border border-[var(--line)] bg-[var(--panel)] ${className}`}>
      {children}
    </div>
  );
}

const BUTTON_TONES: Record<'emerald' | 'zinc' | 'rose', string> = {
  emerald:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 enabled:hover:bg-emerald-500/20',
  zinc: 'border-[var(--line)] bg-zinc-800/40 text-zinc-300 enabled:hover:bg-zinc-800',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300 enabled:hover:bg-rose-500/20',
};

/** A durable-style ghost button: tinted border + faint fill that brightens on hover. */
export function GhostButton({
  children,
  onClick,
  disabled,
  tone = 'zinc',
  title,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'emerald' | 'zinc' | 'rose';
  title?: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`mono rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${BUTTON_TONES[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Centered muted message for empty / loading / error panes. */
export function Notice({ children }: { children: ReactNode }): JSX.Element {
  return <p className="px-1 py-6 text-sm text-zinc-600">{children}</p>;
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
