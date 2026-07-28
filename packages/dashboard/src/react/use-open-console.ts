import { useCallback, useRef, useState } from 'react';
import { type OpenConsoleOptions, openMediaConsole } from '../client/console-session.js';

/**
 * React layer over `openMediaConsole` — the middle tier between the bare function
 * (`../client/console-session.ts`) and the drop-in `<OpenMediaConsoleButton>`.
 *
 * You get the state a launcher UI actually needs (in-flight, error) and keep full control of the
 * markup. Nothing here is Media-specific beyond the endpoint: it is a mint-then-navigate call with
 * the two states that call can be in.
 */
export interface UseOpenConsoleResult {
  /** Start the mint-then-navigate. Never rejects — read `error` instead. */
  open: () => void;
  /** True from the click until the navigation starts, or until it fails. */
  isPending: boolean;
  /**
   * The last refusal, or `null`. Cleared when `open()` is called again.
   *
   * Typed as `Error` rather than `ConsoleSessionError` because `ConsoleSessionError` carries the
   * session endpoint it was refused by, and a failure that did not come from the mint (a `navigate`
   * override that throws) has no endpoint to attribute — inventing one would be a lie. Every
   * refusal from the mint itself IS a `ConsoleSessionError`, so `instanceof` narrows.
   */
  error: Error | null;
  /** Drop a stale error without retrying — e.g. when a dialog closes. */
  reset: () => void;
}

export function useOpenMediaConsole(options: OpenConsoleOptions = {}): UseOpenConsoleResult {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Kept in a ref so a caller passing an inline object literal (the common case) doesn't change the
  // identity of `open` on every render, which would defeat memoizing anything downstream.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const open = useCallback(() => {
    setIsPending(true);
    setError(null);
    void openMediaConsole(optionsRef.current)
      .then(() => {
        // Deliberately NOT clearing `isPending` on success: the navigation is already underway and
        // this component is about to be torn down. Flipping the button back to idle first produces
        // a visible flicker of "ready to click again" on a page that is leaving.
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setIsPending(false);
      });
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { open, isPending, error, reset };
}

/**
 * TanStack Query integration WITHOUT a TanStack dependency: the returned object is the shape
 * `useMutation` takes, so a host that already uses Query wires the launcher into its own cache,
 * devtools and error handling with no extra adapter — and a host that doesn't never pays for it.
 *
 * ```ts
 * const { mutate, isPending } = useMutation(openMediaConsoleMutationOptions({ headers }));
 * ```
 */
export function openMediaConsoleMutationOptions(options: OpenConsoleOptions = {}): {
  mutationKey: readonly unknown[];
  mutationFn: () => Promise<void>;
} {
  return {
    // Both mounts points are in the key: `apiBasePath` decides which endpoint mints the session and
    // is settable independently of `basePath` (flip mounts the console API under its own `/api`
    // prefix), so two mounts differing only in it are two different calls and must not share cache
    // state.
    mutationKey: [
      'media',
      'console',
      'open',
      options.basePath ?? null,
      options.apiBasePath ?? null,
    ] as const,
    mutationFn: () => openMediaConsole(options),
  };
}
