import {
  AttachmentManager,
  DirectUploadManager,
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
import { type DynamicModule, Global, Module, type Provider, type Type } from '@nestjs/common';
import { assertRoutesProtected, decoratedController } from './controller-decorators';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaService } from './media.service';
import {
  MEDIA_ATTACHMENTS,
  MEDIA_DIRECT,
  MEDIA_LIBRARY,
  MEDIA_STORAGE,
  MEDIA_STORAGE_SHARED,
  MEDIA_STORE,
  MEDIA_TUS,
  MEDIA_UPLOADS,
  MEDIA_UPLOAD_SESSIONS,
} from './tokens';

export interface MediaTusOptions {
  disk: string;
  basePath?: string;
  maxSize?: number;
  keyFor?: (filename: string, token: string, metadata: Record<string, string>) => string;
}

export interface MediaDirectOptions {
  disk: string;
  basePath?: string;
  partSize?: number;
}

export interface MediaModuleOptions extends StorageManagerOptions {
  /** Enable the media-library layer (layer 2) by providing a persistence store. */
  store?: MediaStore;
  collections?: MediaCollectionConfig[];
  imageProcessor?: ImageProcessor;
  /** Enable resumable (proxy) uploads by providing a session store. */
  uploadSessions?: UploadSessionStore;
  uploadTmpPrefix?: string;
  /** Mount the tus HTTP controller (requires uploadSessions). */
  tus?: MediaTusOptions;
  /** Mount the direct (S3 multipart presign) upload controller. */
  direct?: MediaDirectOptions;
  /**
   * Modules providing the dependencies of a guard you pass through `decorators` (e.g.
   * `UseGuards(AuthenticationGuard)`) — `forRoot` doesn't otherwise import anything.
   */
  imports?: DynamicModule['imports'];
  /**
   * Class decorators applied to EVERY upload controller this module mounts (tus, multipart,
   * direct), e.g. `[UseGuards(AuthenticationGuard), Can(MediaPolicy, 'upload')]` with the
   * first-party `@nestjs/authentication` / `@nestjs/authorization`. Each registration builds fresh
   * subclasses of the controllers to decorate, so one registration's decorators never reach
   * another. Default: none.
   *
   * Every upload controller is marked `@Can.Anyone()`-open (`'authorization:can-anyone'`) so
   * `@nestjs/authorization`'s deny-by-default global guard doesn't refuse it; a `Can(...)` passed
   * here still applies (the guard only treats `can-anyone` as open when no requirement is
   * declared).
   *
   * In production (`NODE_ENV === 'production'`) a registration that mounts upload routes with no
   * `decorators` refuses to boot — protect them here, or mount them yourself with `routes: false`.
   *
   * With `decorators` set, the mounted controllers are subclasses: resolve them by route, not with
   * `app.get(MediaUploadController)`.
   */
  decorators?: ClassDecorator[];
  /**
   * Which upload controllers this module mounts. `forRoot` mounts a controller only when its
   * feature is configured (`tus` → tus, `uploadSessions` → multipart, `direct` → direct); `mount`
   * narrows that further (`{ direct: false }`). See {@link MediaUploadMount}. Default: mount what's
   * configured.
   */
  mount?: MediaUploadMount;
  /**
   * `false` mounts NO upload controller, while every provider (`MediaService`, `MEDIA_TUS`,
   * `MEDIA_UPLOADS`, `MEDIA_DIRECT`, …) still works — the way NestJS's own packages leave routes to
   * you: serve them from a controller of your own, protected with ordinary Nest decorators (`@Can`,
   * `@UseGuards`), by extending the exported controller classes. The same name as the other Aviary
   * libraries' `routes: false`.
   *
   * ```ts
   * @Can(MediaPolicy, 'upload')
   * @Controller('media/uploads')
   * export class UploadsController extends MediaUploadController {}
   * ```
   */
  routes?: boolean;
}

/**
 * `mount` for `MediaModule.forRoot`/`forRootAsync`: turns single surfaces off (`{ direct: false }`).
 * An omitted key (or `true`) keeps that surface's default. To mount none, `routes: false`.
 */
export interface MediaUploadMount {
  tus?: boolean;
  multipart?: boolean;
  direct?: boolean;
}

/** Whether `surface` is mounted: on by default, off under `routes: false` or `mount[surface]: false`. */
function mounts(
  options: { mount?: MediaUploadMount; routes?: boolean },
  surface: 'tus' | 'multipart' | 'direct',
) {
  if (options.routes === false) return false;
  return options.mount?.[surface] !== false;
}

export interface MediaModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => MediaModuleOptions | Promise<MediaModuleOptions>;
  /**
   * Static, build-time control over which upload controllers get mounted at
   * all. This can't be deferred to the async factory either —
   * Nest registers controllers when the module is built, before `useFactory`
   * runs — so `forRootAsync` mounts all three by default (each 501s when its
   * underlying feature is left unconfigured by the factory). Set the ones you
   * never configure to `false` so they don't exist as dead surface at all, e.g.
   * `mount: { direct: false }` when you don't configure `direct` uploads. A `mount` returned by
   * `useFactory` is ignored.
   */
  mount?: MediaUploadMount;
  /** As {@link MediaModuleOptions.routes}: static, so it lives here, not in `useFactory`'s result. */
  routes?: boolean;
  /**
   * Class decorators applied to every mounted upload controller — see
   * `MediaModuleOptions.decorators`. Static (not resolved by `useFactory`) for the same reason as
   * `mount`: they shape the routes when the module is built, before any factory runs.
   */
  decorators?: ClassDecorator[];
}

/**
 * The three upload controller classes to mount for one registration (see `decoratedController`).
 */
function uploadControllers(decorators: ClassDecorator[] | undefined): {
  tus: Type;
  multipart: Type;
  direct: Type;
} {
  return {
    tus: decoratedController(MediaUploadController, decorators),
    multipart: decoratedController(MediaMultipartUploadController, decorators),
    direct: decoratedController(MediaDirectUploadController, decorators),
  };
}

/** The production rule for one registration — see `assertRoutesProtected`. */
function assertUploadsProtected(
  module: string,
  controllers: Type[],
  decorators: ClassDecorator[] | undefined,
): void {
  assertRoutesProtected({
    module,
    mountsRoutes: controllers.length > 0,
    decorators,
    decoratorsExample:
      "MediaModule.forRoot({ ..., decorators: [UseGuards(AuthenticationGuard), Can(MediaPolicy, 'upload')] })",
    selfMountExample:
      "MediaModule.forRoot({ ..., routes: false }) + @Can(MediaPolicy, 'upload') @Controller('media/uploads') class UploadsController extends MediaUploadController {}",
  });
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

function buildDirect(
  manager: StorageManager,
  options: MediaModuleOptions,
): DirectUploadManager | null {
  if (!options.direct) return null;
  return new DirectUploadManager({
    storage: manager,
    ...(options.direct.partSize ? { defaultPartSize: options.direct.partSize } : {}),
  });
}

@Global()
@Module({})
export class MediaModule {
  static forRoot(options: MediaModuleOptions): DynamicModule {
    const manager = new StorageManager(options);
    const uploads = buildUploads(manager, options);
    const tus = buildTus(uploads, options);
    const direct = buildDirect(manager, options);
    const controllers = uploadControllers(options.decorators);
    const mounted = [
      ...(tus && mounts(options, 'tus') ? [controllers.tus] : []),
      ...(uploads && mounts(options, 'multipart') ? [controllers.multipart] : []),
      ...(direct && mounts(options, 'direct') ? [controllers.direct] : []),
    ];
    assertUploadsProtected('MediaModule.forRoot', mounted, options.decorators);
    return {
      module: MediaModule,
      imports: options.imports ?? [],
      providers: [
        { provide: MEDIA_STORAGE, useValue: manager },
        { provide: MEDIA_STORAGE_SHARED, useExisting: MEDIA_STORAGE },
        { provide: MEDIA_LIBRARY, useValue: buildLibrary(manager, options) },
        { provide: MEDIA_UPLOADS, useValue: uploads },
        { provide: MEDIA_TUS, useValue: tus },
        { provide: MEDIA_ATTACHMENTS, useValue: buildAttachments(manager, options) },
        { provide: MEDIA_DIRECT, useValue: direct },
        { provide: MEDIA_STORE, useValue: options.store ?? null },
        { provide: MEDIA_UPLOAD_SESSIONS, useValue: options.uploadSessions ?? null },
        MediaService,
      ],
      controllers: mounted,
      exports: [
        MediaService,
        MEDIA_STORAGE,
        MEDIA_STORAGE_SHARED,
        MEDIA_LIBRARY,
        MEDIA_UPLOADS,
        MEDIA_TUS,
        MEDIA_ATTACHMENTS,
        MEDIA_DIRECT,
        MEDIA_STORE,
        MEDIA_UPLOAD_SESSIONS,
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
      { provide: MEDIA_STORAGE_SHARED, useExisting: MEDIA_STORAGE },
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
      {
        provide: MEDIA_DIRECT,
        inject: [MEDIA_STORAGE, ...(options.inject ?? [])],
        useFactory: async (manager: StorageManager, ...args: any[]) =>
          buildDirect(manager, await options.useFactory(...args)),
      },
      {
        provide: MEDIA_STORE,
        inject: options.inject ?? [],
        useFactory: async (...args: any[]) => (await options.useFactory(...args)).store ?? null,
      },
      {
        provide: MEDIA_UPLOAD_SESSIONS,
        inject: options.inject ?? [],
        useFactory: async (...args: any[]) =>
          (await options.useFactory(...args)).uploadSessions ?? null,
      },
      MediaService,
    ];
    const controllers = uploadControllers(options.decorators);
    const mounted = [
      ...(mounts(options, 'tus') ? [controllers.tus] : []),
      ...(mounts(options, 'multipart') ? [controllers.multipart] : []),
      ...(mounts(options, 'direct') ? [controllers.direct] : []),
    ];
    assertUploadsProtected('MediaModule.forRootAsync', mounted, options.decorators);
    return {
      module: MediaModule,
      imports: options.imports ?? [],
      providers,
      // Unlike `forRoot`, async options are resolved at runtime by `useFactory`,
      // so we cannot know at module-build time whether `tus`/`direct` are configured
      // and therefore cannot mount these controllers conditionally. Each mounted
      // controller injects its nullable manager token (MEDIA_TUS / MEDIA_UPLOADS /
      // MEDIA_DIRECT) and cleanly responds 501 NotImplemented when its feature is
      // left unconfigured by the factory. `mount` is a separate, STATIC escape
      // hatch (see its JSDoc on `MediaModuleAsyncOptions`) for dropping a
      // controller's route surface entirely instead of leaving it mounted-but-501.
      controllers: mounted,
      exports: [
        MediaService,
        MEDIA_STORAGE,
        MEDIA_STORAGE_SHARED,
        MEDIA_LIBRARY,
        MEDIA_UPLOADS,
        MEDIA_TUS,
        MEDIA_ATTACHMENTS,
        MEDIA_DIRECT,
        MEDIA_STORE,
        MEDIA_UPLOAD_SESSIONS,
      ],
    };
  }
}
