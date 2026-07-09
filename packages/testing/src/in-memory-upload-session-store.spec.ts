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

describe('InMemoryUploadSessionStore createdAt', () => {
  it('create() sets createdAt to now; get()/list() return it as a Date', async () => {
    const store = new InMemoryUploadSessionStore();
    const before = Date.now();
    const created = await store.create(session('a'));
    const after = Date.now();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(created.createdAt?.getTime()).toBeLessThanOrEqual(after);

    const fetched = await store.get('a');
    expect(fetched?.createdAt).toBeInstanceOf(Date);
    expect(fetched?.createdAt?.getTime()).toBe(created.createdAt?.getTime());

    const [listed] = await store.list();
    expect(listed.createdAt).toBeInstanceOf(Date);
    expect(listed.createdAt?.getTime()).toBe(created.createdAt?.getTime());
  });
});

describe('InMemoryUploadSessionStore.list', () => {
  it('list() returns all stored sessions', async () => {
    const store = new InMemoryUploadSessionStore();
    await store.create({ ...session('a'), disk: 'local' });
    await store.create({ ...session('b'), disk: 'files' });
    const all = await store.list();
    expect(all.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('list({ disk }) filters by disk', async () => {
    const store = new InMemoryUploadSessionStore();
    await store.create({ ...session('a'), disk: 'local' });
    await store.create({ ...session('b'), disk: 'files' });
    const filesOnly = await store.list({ disk: 'files' });
    expect(filesOnly.map((s) => s.id)).toEqual(['b']);
  });

  it('list({ disk, keyPrefix }) filters by disk and key prefix', async () => {
    const store = new InMemoryUploadSessionStore();
    await store.create({ ...session('a'), disk: 'files', key: 'reports/2026/a' });
    await store.create({ ...session('b'), disk: 'files', key: 'other/b' });
    await store.create({ ...session('c'), disk: 'local', key: 'reports/2026/c' });
    const scoped = await store.list({ disk: 'files', keyPrefix: 'reports/2026/' });
    expect(scoped.map((s) => s.id)).toEqual(['a']);
  });
});
