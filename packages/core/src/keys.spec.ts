import { InMemoryDisk } from '@nestjs/storage';
import { describe, expect, it } from 'vitest';
import { assertMediaKey, folderPrefix, keySegment } from './keys';

describe('keySegment', () => {
  it('keeps ordinary names', () => {
    expect(keySegment('photo 1.jpg')).toBe('photo 1.jpg');
    expect(keySegment('résumé.pdf')).toBe('résumé.pdf');
  });

  it('turns separators, control characters and dot segments into one safe segment', () => {
    expect(keySegment('../etc/passwd')).toBe('.._etc_passwd');
    expect(keySegment('a\\b')).toBe('a_b');
    expect(keySegment('a\u0000b')).toBe('a_b');
    expect(keySegment('')).toBe('_');
    expect(keySegment('.')).toBe('_');
    expect(keySegment('..')).toBe('_');
  });

  it('produces keys @nestjs/storage accepts', async () => {
    const disk = new InMemoryDisk();
    for (const name of ['../x', '/abs', 'a//b', '..', '', 'x\u001f', 'back\\slash']) {
      await expect(disk.put(`uploads/${keySegment(name)}`, 'x')).resolves.toBeDefined();
    }
  });
});

describe('assertMediaKey', () => {
  it('accepts what the disks accept and refuses what they refuse', async () => {
    const disk = new InMemoryDisk();
    for (const key of ['a', 'a/b.txt', '.uploads/1/0', 'x y/z']) {
      expect(() => assertMediaKey(key)).not.toThrow();
      await expect(disk.put(key, 'x')).resolves.toBeDefined();
    }
    for (const key of ['', '/a', 'a/', 'a//b', 'a/../b', './a', 'a\\b', 'a\u0007']) {
      expect(() => assertMediaKey(key)).toThrow();
      await expect(disk.put(key, 'x')).rejects.toThrow();
    }
  });
});

describe('folderPrefix', () => {
  it('normalizes to one trailing slash', () => {
    expect(folderPrefix('a/b')).toBe('a/b/');
    expect(folderPrefix('a/b/')).toBe('a/b/');
    expect(folderPrefix('')).toBe('');
    expect(() => folderPrefix('/a')).toThrow();
  });
});
