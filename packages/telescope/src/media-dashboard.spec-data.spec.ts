import { describe, expect, it } from 'vitest';
import { mediaDashboard } from './media-dashboard.spec-data';

const PROVIDER_NAMES = new Set([
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
]);

describe('mediaDashboard', () => {
  it('has the media.overview id and only binds known providers', () => {
    const spec = mediaDashboard();
    expect(spec.id).toBe('media.overview');
    expect(spec.label).toBe('Media');
    const panels = (spec.sections ?? []).flatMap((section) => section.panels);
    for (const panel of panels) expect(PROVIDER_NAMES.has(panel.data.provider)).toBe(true);
    // Sections present per proposal §3.
    expect((spec.sections ?? []).map((section) => section.title)).toEqual([
      'Uploads (live)',
      'Upload activity',
      'Media library',
      'Attachments',
      'Disks & config',
    ]);
  });

  it('flat panels stays empty (all panels live under sections)', () => {
    expect(mediaDashboard().panels).toEqual([]);
  });

  it('links the in-progress upload row when uploadHref is given', () => {
    const spec = mediaDashboard({ uploadHref: '/media/uploads/{id}' });
    const table = (spec.sections ?? [])
      .flatMap((section) => section.panels)
      .find((panel) => panel.data.provider === 'media.inProgressUploads');
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') throw new Error('expected a table panel');
    expect(table.columns[0]).toEqual({
      key: 'id',
      label: 'Upload',
      link: { href: '/media/uploads/{id}' },
    });
  });
});
