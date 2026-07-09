import type { ExtensionContext } from '@dudousxd/nestjs-telescope';
import { describe, expect, it } from 'vitest';
import { mediaTelescopeExtension } from './media-telescope.extension';

const ctx = {
  config: {} as ExtensionContext['config'],
  moduleRef: {} as ExtensionContext['moduleRef'],
} as ExtensionContext;

describe('mediaTelescopeExtension', () => {
  it('bundles the watcher, entry type, dashboard, and all providers', () => {
    const ext = mediaTelescopeExtension();
    expect(ext.name).toBe('media');
    expect(ext.watchers?.(ctx).map((watcher) => watcher.type)).toEqual(['media']);
    expect(ext.entryTypes?.(ctx)).toEqual([{ id: 'media', label: 'Media', dot: 'bg-sky-400' }]);
    expect(ext.dashboards?.(ctx).map((dashboard) => dashboard.id)).toEqual(['media.overview']);
    expect(
      ext
        .dataProviders?.(ctx)
        .map((provider) => provider.name)
        .sort(),
    ).toEqual([
      'media.activeUploadCount',
      'media.attachmentActivity',
      'media.byCollection',
      'media.disks',
      'media.inProgressUploads',
      'media.libraryTotals',
      'media.recentUploads',
      'media.storageByDisk',
      'media.storageWritesOverTime',
      'media.uploadSuccessRate',
      'media.uploadThroughput',
      'media.uploadsOverTime',
    ]);
  });

  it('forwards uploadHref through to the dashboard spec', () => {
    const ext = mediaTelescopeExtension({ uploadHref: '/media/uploads/{id}' });
    const dashboard = ext.dashboards?.(ctx)[0];
    const table = dashboard?.sections
      ?.flatMap((section) => section.panels)
      .find((panel) => panel.data.provider === 'media.inProgressUploads');
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') throw new Error('expected a table panel');
    expect(table.columns[0]?.link).toEqual({ href: '/media/uploads/{id}' });
  });
});
