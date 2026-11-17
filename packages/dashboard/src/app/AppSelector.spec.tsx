// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaConsoleClient } from '../client/media-console-client.js';
import type { Topology } from '../client/types.js';
import { AppSelector, appHref } from './AppSelector.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const base: Topology = { hasStore: true, hasUploads: true, disks: 1, actions: true };

describe('appHref', () => {
  it('sets or drops ?app= and keeps the other params, without the hash', () => {
    expect(appHref('orders', { pathname: '/media', search: '' })).toBe('/media?app=orders');
    expect(appHref('', { pathname: '/media', search: '?app=orders&x=1' })).toBe('/media?x=1');
    expect(appHref('', { pathname: '/media', search: '?app=orders' })).toBe('/media');
  });
});

describe('AppSelector', () => {
  it('renders nothing on a console without federation', () => {
    const { container } = render(<AppSelector topology={base} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists the own app and the federated ones, selecting the one in the URL', () => {
    window.history.replaceState(null, '', '/media?app=billing#/library');
    render(
      <AppSelector
        topology={{
          ...base,
          federation: {
            local: { label: 'Central' },
            apps: [
              { name: 'orders', label: 'Orders' },
              { name: 'billing', label: 'Billing' },
            ],
            current: 'billing',
          },
        }}
      />,
    );
    const select = screen.getByLabelText('App') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Central', 'Orders', 'Billing']);
    expect(select.value).toBe('billing');
  });

  it('leaves out the own app when the grant hides it', () => {
    window.history.replaceState(null, '', '/media?app=orders');
    render(
      <AppSelector
        topology={{
          ...base,
          federation: {
            local: null,
            apps: [{ name: 'orders', label: 'Orders' }],
            current: 'orders',
          },
        }}
      />,
    );
    const select = screen.getByLabelText('App') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['orders']);
  });
});

describe('the client names the selected app', () => {
  it('in the x-media-app header of API calls, and in ?app= of byte URLs', async () => {
    window.history.replaceState(null, '', '/media?app=orders#/disks');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(base), { headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetch);
    await mediaConsoleClient.topology();
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('x-media-app')).toBe('orders');
    expect(mediaConsoleClient.objectRawUrl('files', 'a.txt')).toBe(
      '/media/api/disks/files/object/raw?key=a.txt&app=orders',
    );
  });

  it('sends nothing extra for the own app', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(base), { headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetch);
    await mediaConsoleClient.topology();
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('x-media-app')).toBeNull();
    expect(mediaConsoleClient.objectDownloadUrl('files', 'a.txt')).toBe(
      '/media/api/disks/files/object/download?key=a.txt',
    );
  });
});
