import {
  type ImageProcessor,
  type MediaCollectionConfig,
  MediaLibrary,
  type MediaStore,
  StorageManager,
  type StorageManagerOptions,
} from '@dudousxd/nestjs-media-core';
import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { MediaService } from './media.service';
import { MEDIA_LIBRARY, MEDIA_STORAGE } from './tokens';

export interface MediaModuleOptions extends StorageManagerOptions {
  /** Enable the media-library layer (camada 2) by providing a persistence store. */
  store?: MediaStore;
  collections?: MediaCollectionConfig[];
  imageProcessor?: ImageProcessor;
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

@Global()
@Module({})
export class MediaModule {
  static forRoot(options: MediaModuleOptions): DynamicModule {
    const manager = new StorageManager(options);
    const providers: Provider[] = [
      { provide: MEDIA_STORAGE, useValue: manager },
      { provide: MEDIA_LIBRARY, useValue: buildLibrary(manager, options) },
      MediaService,
    ];
    return {
      module: MediaModule,
      providers,
      exports: [MediaService, MEDIA_STORAGE, MEDIA_LIBRARY],
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
      MediaService,
    ];
    return {
      module: MediaModule,
      imports: options.imports ?? [],
      providers,
      exports: [MediaService, MEDIA_STORAGE, MEDIA_LIBRARY],
    };
  }
}
