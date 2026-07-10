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
import {
  type CanActivate,
  type DynamicModule,
  Global,
  Module,
  type Provider,
  type Type,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
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
   * Guard(s) applied to ALL THREE upload controllers (tus, multipart, direct) —
   * whichever of them end up mounted. Third-party controller classes can't be
   * annotated with `@UseGuards` by consumers, so without this option the upload
   * surface is mounted with NO auth: anyone who can reach the app can upload.
   * **Uploads are unauthenticated by default — set `guards` (or otherwise gate
   * these routes, e.g. with a global guard) before exposing this module.**
   *
   * Guard classes are added to this module's `providers` so Nest can DI-instantiate
   * them; if a guard has its own dependencies, pass the modules that provide them
   * via `imports`.
   */
  guards?: Type<CanActivate>[];
  /**
   * Modules providing dependencies for `guards` (or anything else you inject into
   * them). `forRoot` doesn't otherwise import anything, so this exists purely as
   * an `imports` passthrough for guard wiring.
   */
  imports?: DynamicModule['imports'];
}

export interface MediaModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => MediaModuleOptions | Promise<MediaModuleOptions>;
  /**
   * Guard(s) applied to ALL THREE upload controllers. This is a STATIC field on
   * the async config object itself — NOT part of the options resolved by
   * `useFactory` — because controllers (and the enhancers bound to them) are
   * wired at module build time, before any async factory has run. If you need
   * the guard to read async-resolved config (e.g. a secret from a ConfigService),
   * have the guard itself inject that service via DI (see `imports`/`inject`
   * above) rather than trying to pass it through `useFactory`.
   *
   * Same default-open caveat as `MediaModuleOptions.guards`: **omitting this
   * leaves the upload surface unauthenticated.**
   */
  guards?: Type<CanActivate>[];
  /**
   * Static, build-time control over which upload controllers get mounted at
   * all. Unlike `guards`, this can't be deferred to the async factory either —
   * Nest registers controllers when the module is built, before `useFactory`
   * runs — so `forRootAsync` mounts all three by default (each 501s when its
   * underlying feature is left unconfigured by the factory). Set the ones you
   * never configure to `false` so they don't exist as dead surface at all, e.g.
   * `mount: { direct: false }` when you don't configure `direct` uploads.
   */
  mount?: {
    tus?: boolean;
    multipart?: boolean;
    direct?: boolean;
  };
}

/**
 * The three upload controllers guards are stamped onto uniformly. Exported as a
 * fixed tuple so `applyGuards` and the module's `controllers` arrays can't drift.
 */
const UPLOAD_CONTROLLERS: [
  typeof MediaUploadController,
  typeof MediaMultipartUploadController,
  typeof MediaDirectUploadController,
] = [MediaUploadController, MediaMultipartUploadController, MediaDirectUploadController];

/**
 * Stamp (or clear) `@UseGuards`-equivalent metadata on the three shared upload
 * controller classes.
 *
 * Mechanism: `@UseGuards(...guards)` on a controller just does
 * `Reflect.defineMetadata(GUARDS_METADATA, guards, ControllerClass)` (via Nest's
 * `extendArrayMetadata`, which *appends* to any existing array). We call
 * `Reflect.defineMetadata` directly instead of going through `UseGuards`/`extendArrayMetadata`,
 * so each `forRoot`/`forRootAsync` call REPLACES the metadata rather than
 * appending to it — appending would leak guards across repeated module
 * registrations in the same process (every test file that calls `forRoot`
 * more than once, for instance) since these controller classes are
 * module-level singletons shared by every registration.
 *
 * Nest's `GuardsConsumer` reads this metadata per-request via `Reflector`, not
 * once at boot, so the *last* call to stamp it before a request is served wins
 * for that controller class in this process — replace semantics make that
 * "last write" deterministic instead of an ever-growing guard list. The
 * remaining sharp edge: two Nest applications running CONCURRENTLY in the same
 * process with different `guards` on `MediaModule` would still clobber each
 * other (there is exactly one metadata slot per controller class, process-wide).
 * That's a non-issue for a normal app (one `MediaModule` registration) and for
 * this repo's tests (vitest isolates test files, and within a file tests run
 * sequentially against a freshly-compiled `TestingModule` each time).
 */
function applyGuards(guards: Type<CanActivate>[] | undefined): void {
  for (const controller of UPLOAD_CONTROLLERS) {
    Reflect.defineMetadata(GUARDS_METADATA, guards ?? [], controller);
  }
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
    applyGuards(options.guards);
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
        ...(options.guards ?? []),
        MediaService,
      ],
      controllers: [
        ...(tus ? [MediaUploadController] : []),
        ...(uploads ? [MediaMultipartUploadController] : []),
        ...(direct ? [MediaDirectUploadController] : []),
      ],
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
      ...(options.guards ?? []),
      MediaService,
    ];
    applyGuards(options.guards);
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
      controllers: [
        ...(options.mount?.tus === false ? [] : [MediaUploadController]),
        ...(options.mount?.multipart === false ? [] : [MediaMultipartUploadController]),
        ...(options.mount?.direct === false ? [] : [MediaDirectUploadController]),
      ],
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
