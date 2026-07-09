import type { DashboardSpec } from '@dudousxd/nestjs-telescope';

/**
 * The "Media" overview dashboard. `uploadHref` deep-links an in-progress upload row out
 * to a (future Path-B) media SPA, e.g. '/media/uploads/{id}'; omit to render plain ids.
 */
export function mediaDashboard(opts: { uploadHref?: string } = {}): DashboardSpec {
  const uploadColumn = opts.uploadHref
    ? { key: 'id', label: 'Upload', link: { href: opts.uploadHref } }
    : { key: 'id', label: 'Upload' };
  return {
    id: 'media.overview',
    label: 'Media',
    panels: [],
    sections: [
      {
        title: 'Uploads (live)',
        cols: 4,
        panels: [
          {
            kind: 'stat',
            title: 'Active uploads',
            data: { provider: 'media.activeUploadCount' },
            spark: false,
          },
          {
            kind: 'gauge',
            title: 'Upload success rate',
            data: { provider: 'media.uploadSuccessRate' },
            max: 1,
            format: 'percent',
            thresholds: { warn: 0.98, bad: 0.95, direction: 'down-bad' },
          },
          {
            kind: 'stat',
            title: 'Throughput (completes/h)',
            data: { provider: 'media.uploadThroughput' },
            format: 'rate',
            spark: true,
          },
        ],
      },
      {
        title: 'Upload activity',
        cols: 3,
        panels: [
          {
            kind: 'table',
            title: 'In-progress uploads',
            data: { provider: 'media.inProgressUploads' },
            columns: [
              uploadColumn,
              { key: 'disk', label: 'Disk' },
              { key: 'key', label: 'Key' },
              { key: 'percent', label: '%' },
              { key: 'parts', label: 'Parts' },
              { key: 'multipart', label: 'Multipart' },
            ],
          },
          {
            kind: 'timeseries',
            title: 'Uploads over time',
            data: { provider: 'media.uploadsOverTime' },
            series: ['started', 'completed', 'aborted'],
            style: 'stacked',
          },
          {
            kind: 'table',
            title: 'Recent completed uploads',
            data: { provider: 'media.recentUploads' },
            columns: [
              { key: 'id', label: 'Id' },
              { key: 'disk', label: 'Disk' },
              { key: 'key', label: 'Key' },
              { key: 'size', label: 'Size' },
            ],
          },
        ],
      },
      {
        title: 'Media library',
        cols: 4,
        panels: [
          {
            kind: 'stat',
            title: 'Total media',
            data: { provider: 'media.libraryTotals', query: { metric: 'count' } },
            spark: false,
          },
          {
            kind: 'stat',
            title: 'Total bytes',
            data: { provider: 'media.libraryTotals', query: { metric: 'bytes' } },
            spark: false,
          },
          {
            kind: 'breakdown',
            title: 'Media by collection',
            data: { provider: 'media.byCollection' },
            style: 'donut',
          },
          {
            kind: 'breakdown',
            title: 'Storage by disk',
            data: { provider: 'media.storageByDisk' },
            style: 'bar',
          },
          {
            kind: 'timeseries',
            title: 'Storage writes over time',
            data: { provider: 'media.storageWritesOverTime' },
            series: ['attach'],
            style: 'area',
          },
        ],
      },
      {
        title: 'Attachments',
        cols: 2,
        panels: [
          {
            kind: 'timeseries',
            title: 'Attachment activity',
            data: { provider: 'media.attachmentActivity' },
            series: ['created', 'deleted'],
            style: 'stacked',
          },
        ],
      },
      {
        title: 'Disks & config',
        cols: 2,
        panels: [
          {
            kind: 'table',
            title: 'Configured disks',
            data: { provider: 'media.disks' },
            columns: [
              { key: 'name', label: 'Disk' },
              { key: 'default', label: 'Default' },
              { key: 'presign', label: 'Presign' },
              { key: 'multipart', label: 'Multipart' },
              { key: 'publicUrls', label: 'Public URLs' },
              { key: 'list', label: 'List' },
            ],
          },
        ],
      },
    ],
  };
}
