// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lightbox, type PreviewItem } from './Lightbox.js';

afterEach(cleanup);

const ITEM: PreviewItem = {
  disk: 'primary',
  key: 'reports/2026/q1 final.csv',
  name: 'q1 final.csv',
  size: 2048,
  contentType: 'text/csv',
  url: 'https://store.example/reports/2026/q1%20final.csv?X-Amz-Signature=deadbeef',
};

function renderLightbox(): void {
  // The insights query fires on mount; answer it with the empty shape so nothing renders for it.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ insights: [] }), { status: 200 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Lightbox item={ITEM} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('Lightbox — Download', () => {
  it('offers the object through the console own same-origin route, named after the file', () => {
    renderLightbox();
    const download = screen.getByRole('link', { name: 'Download' });

    // Same-origin and pointed at the download route — NOT at `item.url`, which under the default
    // `objectUrls: 'auto'` is a presigned link to the store the browser may have no path to.
    expect(download.getAttribute('href')).toBe(
      '/media/api/disks/primary/object/download?key=reports%2F2026%2Fq1+final.csv',
    );
    expect(download.getAttribute('href')).not.toContain('store.example');
    expect(download.getAttribute('download')).toBe('q1 final.csv');
  });

  it('keeps Open ↗ pointed at the reported url, so the two intents stay distinct', () => {
    renderLightbox();
    expect(screen.getByRole('link', { name: 'Open ↗' }).getAttribute('href')).toBe(ITEM.url);
  });
});
