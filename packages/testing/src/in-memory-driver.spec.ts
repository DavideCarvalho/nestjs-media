import { FileNotFoundError } from '@dudousxd/nestjs-media-core';
import { describe, expect, it } from 'vitest';
import { runStorageDriverConformance } from './conformance';
import { InMemoryDriver } from './in-memory-driver';

runStorageDriverConformance('InMemoryDriver', () => new InMemoryDriver());

describe('InMemoryDriver', () => {
  it('stat returns size, stored content-type and last-modified', async () => {
    const d = new InMemoryDriver();
    await d.put('a.bin', Buffer.from('12345'), { contentType: 'application/x-thing' });
    const meta = await d.stat('a.bin');
    expect(meta.size).toBe(5);
    expect(meta.contentType).toBe('application/x-thing');
    expect(meta.lastModified).toBeInstanceOf(Date);
  });

  it('stat throws FileNotFoundError when absent', async () => {
    await expect(new InMemoryDriver().stat('nope')).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
