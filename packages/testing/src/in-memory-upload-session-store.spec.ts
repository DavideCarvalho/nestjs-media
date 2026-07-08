import { describe, expect, it } from 'vitest';
import { InMemoryUploadSessionStore } from './in-memory-upload-session-store';

function session(id: string) {
  return { id, disk: 's3', key: `k/${id}`, contentType: undefined, size: 30, offset: 0, parts: 0 };
}

describe('InMemoryUploadSessionStore parts', () => {
  it('records parts by number and lists them; delete clears parts', async () => {
    const store = new InMemoryUploadSessionStore();
    await store.create(session('a'));
    await store.addPart('a', { partNumber: 2, etag: 'e2' });
    await store.addPart('a', { partNumber: 1, etag: 'e1' });
    const parts = await store.listParts('a');
    expect([...parts].sort((x, y) => x.partNumber - y.partNumber)).toEqual([
      { partNumber: 1, etag: 'e1' },
      { partNumber: 2, etag: 'e2' },
    ]);
    await store.delete('a');
    expect(await store.listParts('a')).toEqual([]);
  });
});
