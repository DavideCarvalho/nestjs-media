import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWithinRoot } from './path-safety';

describe('resolveWithinRoot', () => {
  const root = resolve('/tmp/media-root');

  it('resolves a normal relative path under root', () => {
    expect(resolveWithinRoot(root, 'a/b.png')).toBe(resolve(root, 'a/b.png'));
  });

  it('rejects parent-traversal escapes', () => {
    expect(() => resolveWithinRoot(root, '../secret')).toThrow();
    expect(() => resolveWithinRoot(root, 'a/../../secret')).toThrow();
  });

  it('rejects absolute paths', () => {
    expect(() => resolveWithinRoot(root, '/etc/passwd')).toThrow();
  });
});
