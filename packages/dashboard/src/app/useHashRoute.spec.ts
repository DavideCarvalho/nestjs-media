import { describe, expect, it } from 'vitest';
import { parseHash } from './useHashRoute.js';

describe('parseHash', () => {
  it('parses the disks tab with disk + prefix', () => {
    expect(parseHash('#/disks/mydisk?prefix=rag/')).toEqual({
      tab: 'disks',
      disk: 'mydisk',
      prefix: 'rag/',
    });
  });

  it('reads the preview key (deep-linkable file preview) alongside prefix', () => {
    expect(parseHash('#/disks/mydisk?prefix=rag/&preview=rag/a/b.md')).toEqual({
      tab: 'disks',
      disk: 'mydisk',
      prefix: 'rag/',
      preview: 'rag/a/b.md',
    });
  });

  it('round-trips a slashed preview key written by URLSearchParams (percent-encoded once)', () => {
    const key = 'rag/019f-abc/uuid-guia-subwo.md';
    const params = new URLSearchParams();
    params.set('preview', key);
    const route = parseHash(`#/disks/mydisk?${params.toString()}`);
    expect(route.preview).toBe(key);
  });

  it('ignores a preview param when no disk segment is present', () => {
    expect(parseHash('#/disks?preview=rag/a/b.md')).toEqual({ tab: 'disks' });
  });
});
