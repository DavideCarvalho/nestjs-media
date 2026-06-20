import {
  type ImageProcessor,
  type MediaCollectionConfig,
  MediaLibrary,
  type MediaStore,
  ResumableUploadManager,
  StorageManager,
  type StorageManagerOptions,
  type UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { MediaService } from './media.service';
import { MEDIA_LIBRARY, MEDIA_STORAGE, MEDIA_UPLOADS } from './tokens';

export interface MediaModuleOptions extends StorageManagerOptions {
  /** Enable the media-library layer (camada 2) by providing a persistence store. */
  store?: MediaStore;
  collections?: MediaCollectionConfig[];
  imageProcessor?: ImageProcessor;
  /** Enable resumable (proxy) uploads by providing a session store. */
  uploadSessions?: UploadSessionStore;
  uploadTmpPrefix?: string;
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

@Global()
@Module({})
export class MediaModule {
  static forRoot(options: MediaModuleOptions): DynamicModule {
    const manager = new StorageManager(options);
    return {
      module: MediaModule,
      providers: [
        { provide: MEDIA_STORAGE, useValue: manager },
        { provide: MEDIA_LIBRARY, useValue: buildLibrary(manager, options) },
        { provide: MEDIA_UPLOADS, useValue: buildUploads(manager, options) },
        MediaService,
      ],
      exports: [MediaService, MEDIA_STORAGE, MEDIA_LIBRARY, MEDIA_UPLOADS],
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
      MediaService,
    ];
    return {
      module: MediaModule,
      imports: options.imports ?? [],
      providers,
      exports: [MediaService, MEDIA_STORAGE, MEDIA_LIBRARY, MEDIA_UPLOADS],
    };
  }
}
