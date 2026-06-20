import { StorageManager, type StorageManagerOptions } from '@dudousxd/nestjs-media-core';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MEDIA_STORAGE } from './tokens';

export interface MediaModuleOptions extends StorageManagerOptions {}

export interface MediaModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => MediaModuleOptions | Promise<MediaModuleOptions>;
}

@Global()
@Module({})
export class MediaModule {
  static forRoot(options: MediaModuleOptions): DynamicModule {
    return {
      module: MediaModule,
      providers: [{ provide: MEDIA_STORAGE, useValue: new StorageManager(options) }, MediaService],
      exports: [MediaService, MEDIA_STORAGE],
    };
  }

  static forRootAsync(options: MediaModuleAsyncOptions): DynamicModule {
    return {
      module: MediaModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: MEDIA_STORAGE,
          inject: options.inject ?? [],
          useFactory: async (...args: any[]) =>
            new StorageManager(await options.useFactory(...args)),
        },
        MediaService,
      ],
      exports: [MediaService, MEDIA_STORAGE],
    };
  }
}
