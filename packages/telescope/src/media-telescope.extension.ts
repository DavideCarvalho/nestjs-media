import { defineTelescopeExtension } from '@dudousxd/nestjs-telescope';
import { mediaDashboard } from './media-dashboard.spec-data';
import {
  mediaActiveUploadCountProvider,
  mediaAttachmentActivityProvider,
  mediaByCollectionProvider,
  mediaDisksProvider,
  mediaInProgressUploadsProvider,
  mediaLibraryTotalsProvider,
  mediaRecentUploadsProvider,
  mediaStorageByDiskProvider,
  mediaStorageWritesOverTimeProvider,
  mediaUploadSuccessRateProvider,
  mediaUploadThroughputProvider,
  mediaUploadsOverTimeProvider,
} from './media-data-providers';
import { MediaWatcher } from './media.watcher';

/** The first-class Telescope extension for nestjs-media: watcher + Media overview dashboard. */
export function mediaTelescopeExtension(opts: { uploadHref?: string } = {}) {
  return defineTelescopeExtension({
    name: 'media',
    watchers: () => [new MediaWatcher()],
    entryTypes: () => [{ id: 'media', label: 'Media', dot: 'bg-sky-400' }],
    dashboards: () => [mediaDashboard(opts)],
    dataProviders: () => [
      mediaInProgressUploadsProvider(),
      mediaActiveUploadCountProvider(),
      mediaUploadSuccessRateProvider(),
      mediaUploadsOverTimeProvider(),
      mediaUploadThroughputProvider(),
      mediaRecentUploadsProvider(),
      mediaLibraryTotalsProvider(),
      mediaByCollectionProvider(),
      mediaStorageByDiskProvider(),
      mediaStorageWritesOverTimeProvider(),
      mediaAttachmentActivityProvider(),
      mediaDisksProvider(),
    ],
  });
}
