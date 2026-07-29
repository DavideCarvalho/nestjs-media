// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpenMediaConsoleButton } from './open-console-button.js';
import { openMediaConsoleMutationOptions } from './use-open-console.js';

function response(init: { status?: number; type?: string } = {}): Response {
  const status = init.status ?? 204;
  return { ok: status >= 200 && status < 300, status, type: init.type ?? 'basic' } as Response;
}

/**
 * `pageshow` is what the browser fires when a page is shown, including a bfcache restore
 * (`persisted: true`). jsdom does implement `PageTransitionEvent`, but it is the kind of DOM
 * constructor that is missing or unconstructable in other environments a host may run these under,
 * so fall back to a plain `Event` with the one field the listener reads.
 */
function pageShowEvent(persisted: boolean): Event {
  const Ctor = (globalThis as { PageTransitionEvent?: typeof PageTransitionEvent })
    .PageTransitionEvent;
  if (typeof Ctor === 'function') {
    try {
      return new Ctor('pageshow', { persisted });
    } catch {
      // fall through
    }
  }
  return Object.assign(new Event('pageshow'), { persisted });
}

describe('openMediaConsoleMutationOptions', () => {
  it('returns a useMutation-shaped object without depending on TanStack', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    const navigate = vi.fn();
    const options = openMediaConsoleMutationOptions({ fetch: fetchMock, navigate });

    // The point of the shape: a host passes this straight into `useMutation`, and this package
    // never imports @tanstack/react-query — so a host that doesn't use Query pays nothing.
    expect(options.mutationKey).toEqual(['media', 'console', 'open', null, null]);
    await options.mutationFn();
    expect(navigate).toHaveBeenCalledWith('/media');
  });

  it('keys by basePath so two mounts do not share cache state', () => {
    expect(openMediaConsoleMutationOptions({ basePath: '/ops' }).mutationKey).toEqual([
      'media',
      'console',
      'open',
      '/ops',
      null,
    ]);
  });

  it('keys by apiBasePath too, since it changes which endpoint is minted', () => {
    // Two consoles served from the same path whose APIs are mounted apart (a host with its own
    // global `/api` prefix) are two different calls; sharing one cache entry would let one mount's
    // refusal answer for the other.
    const a = openMediaConsoleMutationOptions({ basePath: '/media', apiBasePath: '/api/media' });
    const b = openMediaConsoleMutationOptions({ basePath: '/media' });

    expect(a.mutationKey).toEqual(['media', 'console', 'open', '/media', '/api/media']);
    expect(a.mutationKey).not.toEqual(b.mutationKey);
  });
});

describe('<OpenMediaConsoleButton>', () => {
  it('mints and navigates on click', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    const navigate = vi.fn();
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={navigate} />);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/media'));
  });

  it('forwards apiBasePath to the mint request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    render(
      <OpenMediaConsoleButton
        basePath="/media"
        apiBasePath="/api/media"
        fetch={fetchMock}
        navigate={vi.fn()}
      />,
    );

    await act(async () => {
      screen.getByRole('button').click();
    });

    // Dropping `apiBasePath` on the way through the button would 404 against `${basePath}/api` —
    // and the only symptom would be a launcher that refuses for a host that wired it correctly.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/media/session', expect.anything()),
    );
  });

  it('surfaces a refusal instead of failing silently', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 403 }));
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={vi.fn()} />);

    await act(async () => {
      screen.getByRole('button').click();
    });

    // A button that silently does nothing reads as broken rather than forbidden — the single most
    // important behaviour for a launcher, and the reason the error renders by default.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTP 403/));
  });

  it('does not navigate when the mint is refused', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 401 }));
    const navigate = vi.fn();
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={navigate} />);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders a custom error node when asked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 403 }));
    render(
      <OpenMediaConsoleButton
        fetch={fetchMock}
        navigate={vi.fn()}
        renderError={(error) => <span data-testid="mine">{error.message}</span>}
      />,
    );

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(screen.getByTestId('mine')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing for the error when renderError is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 403 }));
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={vi.fn()} renderError={null} />);

    await act(async () => {
      screen.getByRole('button').click();
    });

    // Opting out entirely must be possible for a host that surfaces errors its own way (a toast).
    await waitFor(() =>
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('forwards button props so it inherits the host design system', () => {
    render(
      <OpenMediaConsoleButton className="btn btn-primary" data-testid="launcher" title="Open it" />,
    );

    // Unstyled-and-forwarding is the whole reason this ships no CSS.
    const button = screen.getByTestId('launcher');
    expect(button.className).toBe('btn btn-primary');
    expect(button.getAttribute('title')).toBe('Open it');
    expect(button.textContent).toBe('Open Media console');
  });

  it('disables itself while in flight', async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={vi.fn()} />);
    const button = screen.getByRole('button');

    await act(async () => {
      button.click();
    });

    // Without this a double-click fires two mints, and the second can land after the navigation.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      release(response());
    });
  });

  it('stays disabled after a successful mint, because the navigation is already underway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    const navigate = vi.fn();
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={navigate} />);
    const button = screen.getByRole('button') as HTMLButtonElement;

    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    // The anti-flicker guarantee: going back to idle on a page that is leaving flashes
    // "ready to click again". Any bfcache fix must not relax this.
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('re-enables when the page is restored from the bfcache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    const navigate = vi.fn();
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={navigate} />);
    const button = screen.getByRole('button') as HTMLButtonElement;

    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(button.disabled).toBe(true);

    // Back/forward cache restores this page with React state intact, so the spinner left behind by
    // the navigation would otherwise never stop — on a button the user can no longer click.
    await act(async () => {
      globalThis.dispatchEvent(pageShowEvent(true));
    });

    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.textContent).toBe('Open Media console');
  });

  it('ignores a pageshow that is not a bfcache restore', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    render(<OpenMediaConsoleButton fetch={fetchMock} navigate={vi.fn()} />);
    const button = screen.getByRole('button') as HTMLButtonElement;

    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(button.disabled).toBe(true));

    // A fresh load fires `pageshow` too. Clearing on that one would undo the anti-flicker guarantee
    // for every ordinary navigation.
    await act(async () => {
      globalThis.dispatchEvent(pageShowEvent(false));
    });

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('removes the pageshow listener on unmount', async () => {
    const addSpy = vi.spyOn(globalThis, 'addEventListener');
    const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = render(
        <OpenMediaConsoleButton fetch={vi.fn().mockResolvedValue(response())} navigate={vi.fn()} />,
      );

      const added = addSpy.mock.calls.filter(([type]) => type === 'pageshow');
      expect(added).toHaveLength(1);

      unmount();

      // Same function identity, or the listener leaks for the lifetime of the page and every
      // subsequent restore calls setState on an unmounted tree.
      const removed = removeSpy.mock.calls.filter(([type]) => type === 'pageshow');
      expect(removed).toHaveLength(1);
      expect(removed[0]?.[1]).toBe(added[0]?.[1]);

      await act(async () => {
        globalThis.dispatchEvent(pageShowEvent(true));
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
      consoleError.mockRestore();
    }
  });
});
