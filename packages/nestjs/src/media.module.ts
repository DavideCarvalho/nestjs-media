import {
  AttachmentManager,
  type ImageProcessor,
  type MediaCollectionConfig,
  MediaLibrary,
  type MediaStore,
  ResumableUploadManager,
  StorageManager,
  type StorageManagerOptions,
  TusUploadHandler,
  type UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { MediaUploadController } from './media-upload.controller';
import { MediaService } from './media.service';
import {
  MEDIA_ATTACHMENTS,
  MEDIA_LIBRARY,
  MEDIA_STORAGE,
  MEDIA_TUS,
  MEDIA_UPLOADS,
} from './tokens';

export interface MediaTusOptions {
  disk: string;
  basePath?: string;
  maxSize?: number;
  keyFor?: (filename: string, token: string, metadata: Record<string, string>) => string;
}

export interface MediaModuleOptions extends StorageManagerOptions {
  /** Enable the media-library layer (camada 2) by providing a persistence store. */
  store?: MediaStore;
  collections?: MediaCollectionConfig[];
  imageProcessor?: ImageProcessor;
  /** Enable resumable (proxy) uploads by providing a session store. */
  uploadSessions?: UploadSessionStore;
  uploadTmpPrefix?: string;
  /** Mount the tus HTTP controller (requires uploadSessions). */
  tus?: MediaTusOptions;
}

export interface MediaModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => MediaModuleOptions | Promise<MediaModuleOptions>;
}

function buildLibrary(manager: StorageManager, options: MediaModuleOptions): MediaLibrary | null {
  if (!options.store) return null;
  return new MediaLibrary({
    storage: manager,
    store: options.store,
    ...(options.collections ? { collections: options.collections } : {}),
    ...(options.imageProcessor ? { imageProcessor: options.imageProcessor } : {}),
  });
}

function buildAttachments(manager: StorageManager, options: MediaModuleOptions): AttachmentManager {
  return new AttachmentManager({
    storage: manager,
    ...(options.imageProcessor ? { imageProcessor: options.imageProcessor } : {}),
  });
}

function buildUploads(
  manager: StorageManager,
  options: MediaModuleOptions,
): ResumableUploadManager | null {
  if (!options.uploadSessions) return null;
  return new ResumableUploadManager({
    storage: manager,
    sessions: options.uploadSessions,
    ...(options.uploadTmpPrefix ? { tmpPrefix: options.uploadTmpPrefix } : {}),
  });
}

function buildTus(
  uploads: ResumableUploadManager | null,
  options: MediaModuleOptions,
): TusUploadHandler | null {
  if (!uploads || !options.tus) return null;
  return new TusUploadHandler({
    manager: uploads,
    disk: options.tus.disk,
    basePath: options.tus.basePath ?? '/media/uploads',
    ...(options.tus.maxSize ? { maxSize: options.tus.maxSize } : {}),
    ...(options.tus.keyFor ? { keyFor: options.tus.keyFor } : {}),
  });
}

@Global()
@Module({})
export class MediaModule {
  static forRoot(options: MediaModuleOptions): DynamicModule {
    const manager = new StorageManager(options);
    const uploads = buildUploads(manager, options);
    const tus = buildTus(uploads, options);
    return {
      module: MediaModule,
      providers: [
        { provide: MEDIA_STORAGE, useValue: manager },
        { provide: MEDIA_LIBRARY, useValue: buildLibrary(manager, options) },
        { provide: MEDIA_UPLOADS, useValue: uploads },
        { provide: MEDIA_TUS, useValue: tus },
        { provide: MEDIA_ATTACHMENTS, useValue: buildAttachments(manager, options) },
        MediaService,
      ],
      controllers: tus ? [MediaUploadController] : [],
      exports: [
        MediaService,
        MEDIA_STORAGE,
        MEDIA_LIBRARY,
        MEDIA_UPLOADS,
        MEDIA_TUS,
        MEDIA_ATTACHMENTS,
      ],
    };
  }

  static forRootAsync(options: MediaModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: MEDIA_STORAGE,
        inject: options.inject ?? [],
        useFactory: async (...args: any[]) => new StorageManager(await options.useFactory(...args)),
      },
      {
        provide: MEDIA_LIBRARY,
        inject: [MEDIA_STORAGE, ...(options.inject ?? [])],
        useFactory: async (manager: StorageManager, ...args: any[]) =>
          buildLibrary(manager, await options.useFactory(...args)),
      },
      {
        provide: MEDIA_UPLOADS,
        inject: [MEDIA_STORAGE, ...(options.inject ?? [])],
        useFactory: async (manager: StorageManager, ...args: any[]) =>
          buildUploads(manager, await options.useFactory(...args)),
      },
      {
        provide: MEDIA_TUS,
        inject: [MEDIA_UPLOADS, ...(options.inject ?? [])],
        useFactory: async (uploads: ResumableUploadManager | null, ...args: any[]) =>
          buildTus(uploads, await options.useFactory(...args)),
      },
      {
        provide: MEDIA_ATTACHMENTS,
        inject: [MEDIA_STORAGE, ...(options.inject ?? [])],
        useFactory: async (manager: StorageManager, ...args: any[]) =>
          buildAttachments(manager, await options.useFactory(...args)),
      },
      MediaService,
    ];
    return {
      module: MediaModule,
      imports: options.imports ?? [],
      providers,
      exports: [
        MediaService,
        MEDIA_STORAGE,
        MEDIA_LIBRARY,
        MEDIA_UPLOADS,
        MEDIA_TUS,
        MEDIA_ATTACHMENTS,
      ],
    };
  }
}
