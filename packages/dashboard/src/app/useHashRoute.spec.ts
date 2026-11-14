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

  it('falls back to the tab on a malformed escape instead of throwing', () => {
    expect(parseHash('#/disks/%E0%A4%A')).toEqual({ tab: 'disks' });
    expect(parseHash('#/uploads/%')).toEqual({ tab: 'uploads' });
    expect(parseHash('#/library/%zz')).toEqual({ tab: 'library' });
    // A key with a literal `%` (already decoded by URLSearchParams) stays as it is.
    expect(parseHash('#/disks/d?preview=50%25off.png').preview).toBe('50%off.png');
  });

  it('ignores a preview param when no disk segment is present', () => {
    expect(parseHash('#/disks?preview=rag/a/b.md')).toEqual({ tab: 'disks' });
  });

  it('parses the collections page (the LIBRARY section of the sidebar)', () => {
    expect(parseHash('#/collections')).toEqual({ tab: 'collections' });
  });
});
