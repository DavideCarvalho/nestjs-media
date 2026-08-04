import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaConsoleClient } from './media-console-client.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture what the client asked for, and answer with whatever the test wants back. */
function stubFetch(respond: () => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as unknown as typeof fetch;
  return calls;
}

describe('mediaConsoleClient.objectRange', () => {
  it('asks for an inclusive byte range and returns just those bytes', async () => {
    const calls = stubFetch(
      () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, statusText: 'Partial' }),
    );

    const bytes = await mediaConsoleClient.objectRange('primary', 'db/app.sqlite', 4096, 8191);

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(calls[0]?.url).toContain('/disks/primary/object/raw?key=db%2Fapp.sqlite');
    // Inclusive end, verbatim — 4096..8191 is 4096 bytes, and the server reads it the same way.
    expect((calls[0]?.init?.headers as Record<string, string>).Range).toBe('bytes=4096-8191');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
  });

  it('THROWS on a 200 — a dropped Range header must never look like a successful page read', async () => {
    // The failure this guards: a proxy strips `Range`, the server streams the entire 400 MB object,
    // and a caller that just took the buffer would read its page out of the front and carry on.
    stubFetch(() => new Response(new Uint8Array(64), { status: 200, statusText: 'OK' }));

    await expect(mediaConsoleClient.objectRange('primary', 'db/app.sqlite', 0, 63)).rejects.toThrow(
      /200 \(full body\) instead of 206/,
    );
  });

  it('throws on an error status', async () => {
    stubFetch(() => new Response('nope', { status: 416, statusText: 'Range Not Satisfiable' }));
    await expect(mediaConsoleClient.objectRange('primary', 'a.txt', 900, 999)).rejects.toThrow(
      /416/,
    );
  });
});
