import type { ExtensionContext } from '@dudousxd/nestjs-telescope';
import { ExtensionRegistry } from '@dudousxd/nestjs-telescope';
import { describe, expect, it } from 'vitest';
import { mediaTelescopeExtension } from './media-telescope.extension';

function ctxResolving(map: Map<unknown, unknown>): ExtensionContext {
  return {
    config: {} as ExtensionContext['config'],
    moduleRef: {
      get: (token: unknown) => map.get(token),
    } as unknown as ExtensionContext['moduleRef'],
  };
}

describe('media extension integrates with the real Telescope ExtensionRegistry', () => {
  it('registers the media entry type, dashboard, and all 12 providers without collision', () => {
    const ctx = ctxResolving(new Map());
    const registry = new ExtensionRegistry([mediaTelescopeExtension()], ctx);

    expect(registry.watchers().map((watcher) => watcher.type)).toEqual(['media']);
    expect(registry.entryTypes().map((entryType) => entryType.id)).toContain('media');
    expect(registry.dashboards().map((dashboard) => dashboard.id)).toContain('media.overview');
    for (const name of [
      'media.inProgressUploads',
      'media.activeUploadCount',
      'media.uploadSuccessRate',
      'media.uploadsOverTime',
      'media.uploadThroughput',
      'media.recentUploads',
      'media.libraryTotals',
      'media.byCollection',
      'media.storageByDisk',
      'media.storageWritesOverTime',
      'media.attachmentActivity',
      'media.disks',
    ]) {
      expect(registry.findProvider(name)).toBeDefined();
    }
  });

  it('resolves media.disks against a real StorageManager reached via MEDIA_STORAGE_SHARED', async () => {
    const { StorageManager } = await import('@dudousxd/nestjs-media-core');
    const { InMemoryDriver } = await import('@dudousxd/nestjs-media-testing');
    const { MEDIA_STORAGE_SHARED } = await import('./media-tokens');
    const manager = new StorageManager({
      default: 'local',
      disks: { local: new InMemoryDriver() },
    });
    const ctx = ctxResolving(new Map<unknown, unknown>([[MEDIA_STORAGE_SHARED, manager]]));
    const registry = new ExtensionRegistry([mediaTelescopeExtension()], ctx);

    const provider = registry.findProvider('media.disks');
    expect(provider).toBeDefined();
    if (!provider) throw new Error('media.disks provider not found');
    const result = (await provider.resolve(undefined, ctx)) as { rows: Array<{ name: string }> };
    expect(result.rows.map((row) => row.name)).toEqual(['local']);
  });

  /**
   * `mediaDashboard()` puts every panel under `DashboardSpec.sections` (with a flat
   * `panels: []`), exactly like durable's Workflows dashboard. The pinned
   * `@dudousxd/nestjs-telescope@1.11.2`'s `TelescopeService.getMeta()` forwards
   * `sections` (`nest/telescope.service.ts`: `...(d.sections ? { sections: d.sections }
   * : {})` — the fix for the `1.10.0` regression this file's caveat warns about), so a
   * media DashboardSpec here is NOT dropped at the meta endpoint. This test asserts the
   * registry hands back the same `sections` the extension declared (no dashboard-shape
   * normalization happens before `getMeta` reads `d.sections`), which is the part of the
   * chain this package controls; the `getMeta` forwarding itself is asserted by
   * telescope core's own suite, not re-tested here.
   */
  it('the dashboard spec carries its panels under sections, not the flat panels array', () => {
    const ctx = ctxResolving(new Map());
    const registry = new ExtensionRegistry([mediaTelescopeExtension()], ctx);
    const dashboard = registry.dashboards().find((entry) => entry.id === 'media.overview');
    expect(dashboard).toBeDefined();
    if (!dashboard) throw new Error('media.overview dashboard not found');
    expect(dashboard.panels).toEqual([]);
    expect(dashboard.sections?.length).toBeGreaterThan(0);
  });

  it('resolves the dashboard panels to known providers (no dangling bindings)', () => {
    const ctx = ctxResolving(new Map());
    const registry = new ExtensionRegistry([mediaTelescopeExtension()], ctx);
    const dashboard = registry.dashboards().find((entry) => entry.id === 'media.overview');
    expect(dashboard).toBeDefined();
    if (!dashboard) throw new Error('media.overview dashboard not found');
    for (const panel of dashboard.sections?.flatMap((section) => section.panels) ?? []) {
      expect(registry.findProvider(panel.data.provider)).toBeDefined();
    }
  });
});
