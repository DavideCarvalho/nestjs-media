import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { mediaConsoleClient } from '../client/media-console-client.js';

/** The emerald media mark, standalone (App's copy isn't exported to avoid a cycle). */
function Mark(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 text-emerald-400"
      role="img"
      aria-label="media"
    >
      <title>media</title>
      <path d="M12 3 21 7.5 12 12 3 7.5z" opacity={0.9} />
      <path d="M3 12l9 4.5L21 12" opacity={0.55} />
      <path d="M3 16.5 12 21l9-4.5" opacity={0.3} />
    </svg>
  );
}

/**
 * The console's login gate, shown when `GET /me` reports the session is missing. Submits credentials
 * to the built-in login and, on success, invalidates the auth query so the app re-renders into the
 * console. Matches the console's dark blueprint theme.
 */
export function AuthScreen({ modes }: { modes: string[] }): JSX.Element {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const supportsLogin = modes.includes('login');

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await mediaConsoleClient.login(username, password);
      await queryClient.invalidateQueries();
    } catch {
      setError('Invalid credentials.');
      setPending(false);
    }
  }

  return (
    <>
      <div className="app-bg" />
      <div className="relative z-10 grid h-full place-items-center p-6">
        <div className="w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--panel)] p-6 shadow-2xl">
          <div className="mb-5 flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-md border border-emerald-500/30 bg-emerald-500/10">
              <Mark />
            </div>
            <div className="leading-none">
              <div className="text-sm font-semibold tracking-tight">media</div>
              <div className="mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                console
              </div>
            </div>
          </div>

          {supportsLogin ? (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="mono text-[10px] uppercase tracking-wider text-zinc-600">
                  email
                </span>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="mono rounded-md border border-[var(--line)] bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500/40 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono text-[10px] uppercase tracking-wider text-zinc-600">
                  password
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mono rounded-md border border-[var(--line)] bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500/40 focus:outline-none"
                />
              </label>
              {error && <div className="mono text-[11px] text-rose-400">{error}</div>}
              <button
                type="submit"
                disabled={pending}
                className="mono mt-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {pending ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <div className="mono text-xs text-zinc-500">
              This console is gated by the host application. Sign in there and reload.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
