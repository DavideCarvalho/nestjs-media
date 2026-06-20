import { describe, expect, it, vi } from 'vitest';
import { mediaUrl, uploadMedia } from './index';

function mockFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      return { headers: new Headers({ Location: '/media/uploads/s1' }) } as Response;
    }
    const headers = init.headers as Record<string, string>;
    const offset = Number(headers['Upload-Offset']);
    const body = init.body as Blob;
    return { headers: new Headers({ 'Upload-Offset': String(offset + body.size) }) } as Response;
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
