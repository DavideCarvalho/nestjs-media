import { describe, expect, it, vi } from 'vitest';
import { mediaUrl, streamChunks, streamChunksParallel, uploadMedia } from './index';

function mockFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      return { ok: true, headers: new Headers({ Location: '/media/uploads/s1' }) } as Response;
    }
    const headers = init.headers as Record<string, string>;
    const offset = Number(headers['Upload-Offset']);
    const body = init.body as Blob;
    return {
      ok: true,
      headers: new Headers({ 'Upload-Offset': String(offset + body.size) }),
    } as Response;
  });
}

describe('uploadMedia', () => {
  it('creates then PATCHes chunks until complete', async () => {
    const fetchImpl = mockFetch();
    const progress: number[] = [];
    const result = await uploadMedia(new Blob(['hello']), {
      filename: 'a.txt',
      contentType: 'text/plain',
      chunkSize: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: (sent, total) => progress.push(sent / total),
    });

    expect(result.location).toBe('/media/uploads/s1');
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 1 POST + ceil(5/2)=3 PATCH
    expect(progress.at(-1)).toBe(1);
    const post = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((post.headers as Record<string, string>)['Upload-Length']).toBe('5');
  });

  it('throws when no Location is returned', async () => {
    const fetchImpl = vi.fn(async () => ({ headers: new Headers() }) as Response);
    await expect(
      uploadMedia(new Blob(['x']), {
        filename: 'x',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Location/);
  });
});

describe('mediaUrl', () => {
  it('builds id and conversion URLs', () => {
    expect(mediaUrl('abc')).toBe('/media/abc');
    expect(mediaUrl('a b', 'thumb')).toBe('/media/a%20b?conversion=thumb');
  });
});

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

describe('streamChunksParallel', () => {
  it('PUTs each part by number, respects the concurrency cap, then completes', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      calls.push(`${init.method} ${url}`);
      if (init.method === 'PUT') {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      }
      return { ok: true, headers: new Map() } as any;
    });

    const onProgress = vi.fn();

    // 25 bytes @ 10-byte chunks => 3 parts (1,2,3).
    await streamChunksParallel('/api/media/uploads/xyz', blobOf(25), {
      chunkSize: 10,
      concurrency: 2,
      fetchImpl: fetchImpl as any,
      onProgress,
    });

    expect(calls).toContain('PUT /api/media/uploads/xyz/parts/1');
    expect(calls).toContain('PUT /api/media/uploads/xyz/parts/2');
    expect(calls).toContain('PUT /api/media/uploads/xyz/parts/3');
    expect(calls).toContain('POST /api/media/uploads/xyz/complete');
    expect(maxInFlight).toBe(2);
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls.at(-1) as [number, number];
    expect(lastCall[0]).toBe(25);
    expect(lastCall[1]).toBe(25);
  });

  it('rejects with the real failure and stops starting new part PUTs once one part fails', async () => {
    let putCount = 0;
    const partCount = 100; // 1000 bytes @ 10-byte chunks
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'PUT') {
        putCount += 1;
        if (putCount === 1) throw new Error('boom: first part rejected');
        return { ok: true, headers: new Map() } as unknown as Response;
      }
      return { ok: true, headers: new Map() } as unknown as Response;
    });

    await expect(
      streamChunksParallel('/api/media/uploads/big', blobOf(partCount * 10), {
        chunkSize: 10,
        concurrency: 4,
        retries: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('boom: first part rejected');

    // Bounded by concurrency (a handful of in-flight parts), nowhere near the full file.
    expect(putCount).toBeGreaterThan(0);
    expect(putCount).toBeLessThan(partCount / 2);
  });

  it('forwards the abort signal into every part PUT and the complete POST', async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal ?? undefined);
      return { ok: true, headers: new Map() } as unknown as Response;
    });

    await streamChunksParallel('/api/media/uploads/sig', blobOf(20), {
      chunkSize: 10,
      concurrency: 2,
      signal: controller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe('uploadMedia (back-compat)', () => {
  it('still creates a session then PATCHes sequentially', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: any) => ({
      ok: true,
      headers: new Map([
        ['Location', '/media/uploads/abc'],
        ['Upload-Offset', '10'],
      ]),
    })) as any;
    const result = await uploadMedia(blobOf(10), {
      filename: 'f.bin',
      basePath: '/media/uploads',
      fetchImpl,
    });
    expect(result.location).toBe('/media/uploads/abc');
  });
});

describe('getHeaders', () => {
  it('is resolved once per request across a multi-part parallel upload (streamChunksParallel)', async () => {
    const capturedHeaders: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      capturedHeaders.push({ ...(init.headers as Record<string, string>) });
      return { ok: true, headers: new Map() } as any;
    });
    const getHeaders = vi.fn(async () => ({ Authorization: 'Bearer live-token' }));

    // 25 bytes @ 10-byte chunks => 3 parts + 1 complete POST = 4 requests.
    await streamChunksParallel('/api/media/uploads/xyz', blobOf(25), {
      chunkSize: 10,
      concurrency: 2,
      fetchImpl: fetchImpl as any,
      getHeaders,
    });

    expect(getHeaders).toHaveBeenCalledTimes(4);
    for (const headers of capturedHeaders) {
      expect(headers.Authorization).toBe('Bearer live-token');
    }
  });

  it('is resolved once per request across a sequential upload (streamChunks: HEAD + each PATCH)', async () => {
    const capturedHeaders: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      capturedHeaders.push({ ...(init.headers as Record<string, string>) });
      if (init.method === 'HEAD') {
        return { ok: true, headers: new Headers({ 'Upload-Offset': '0' }) } as any;
      }
      const offset = Number((init.headers as Record<string, string>)['Upload-Offset']);
      const body = init.body as Blob;
      return {
        ok: true,
        headers: new Headers({ 'Upload-Offset': String(offset + body.size) }),
      } as any;
    });
    const getHeaders = vi.fn(async () => ({ Authorization: 'Bearer live-token' }));

    // 25 bytes @ 10-byte chunks => 1 HEAD + 3 PATCH = 4 requests.
    await streamChunks('/api/media/uploads/seq', blobOf(25), {
      chunkSize: 10,
      fetchImpl: fetchImpl as any,
      getHeaders,
    });

    expect(getHeaders).toHaveBeenCalledTimes(4);
    for (const headers of capturedHeaders) {
      expect(headers.Authorization).toBe('Bearer live-token');
    }
  });

  it('merges dynamic headers over static headers, dynamic wins on key conflict', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      capturedHeaders = { ...(init.headers as Record<string, string>) };
      return { ok: true, headers: new Headers({ 'Upload-Offset': '5' }) } as any;
    });

    await streamChunks('/api/media/uploads/merge', blobOf(5), {
      resume: false,
      fetchImpl: fetchImpl as any,
      headers: { Authorization: 'static-token', 'X-Custom': 'keep-me' },
      getHeaders: () => ({ Authorization: 'fresh-token' }),
    });

    expect(capturedHeaders.Authorization).toBe('fresh-token');
    expect(capturedHeaders['X-Custom']).toBe('keep-me');
  });

  it('supports an async getHeaders that resolves per request, through the uploadMedia wrapper', async () => {
    const capturedHeaders: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      capturedHeaders.push({ ...(init.headers as Record<string, string>) });
      if (init.method === 'POST' && !String(_url).endsWith('/complete')) {
        return { ok: true, headers: new Headers({ Location: '/media/uploads/tok' }) } as any;
      }
      const offset = Number((init.headers as Record<string, string>)['Upload-Offset'] ?? 0);
      const body = init.body as Blob;
      return {
        ok: true,
        headers: new Headers({ 'Upload-Offset': String(offset + body.size) }),
      } as any;
    });

    let tokenCounter = 0;
    const getHeaders = vi.fn(async () => {
      tokenCounter += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { Authorization: `Bearer token-${tokenCounter}` };
    });

    await uploadMedia(blobOf(5), {
      filename: 'a.txt',
      fetchImpl: fetchImpl as any,
      getHeaders,
    });

    // 1 create-session POST + 1 PATCH (resume:false, single chunk) = 2 requests.
    expect(getHeaders).toHaveBeenCalledTimes(2);
    expect(capturedHeaders[0]?.Authorization).toBe('Bearer token-1');
    expect(capturedHeaders[1]?.Authorization).toBe('Bearer token-2');
  });
});
