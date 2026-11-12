import {
  AttachmentManager,
  DirectUploadManager,
  type ImageProcessor,
  type MediaCollectionConfig,
  MediaLibrary,
  type MediaRecord,
  type MediaStore,
  type MediaTenancyOption,
  type MediaTenantMatch,
  type MultipartDrivers,
  ResumableUploadManager,
  TusUploadHandler,
  type UploadSessionStore,
  canSeeRow,
  keySegment,
  readTenancy,
  tenantMatch,
} from '@dudousxd/nestjs-media-core';
import {
  type DynamicModule,
  type FactoryProvider,
  Global,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
  type Provider,
  type Type,
} from '@nestjs/common';
import { Storage } from '@nestjs/storage';
import { assertRoutesProtected, decoratedController } from './controller-decorators';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaService } from './media.service';
import {
  MEDIA_ATTACHMENTS,
  MEDIA_DIRECT,
  MEDIA_LIBRARY,
  MEDIA_MULTIPART,
  MEDIA_OPTIONS,
  MEDIA_STORE,
  MEDIA_TENANCY,
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

/** What `MediaService` checks before it acts (see {@link MediaModuleOptions.authorize}). */
export type MediaAction = 'read' | 'attach' | 'delete';

/** What an `attach` is checked against: the record doesn't exist yet. */
export interface MediaAttachTarget {
  ownerType: string;
  ownerId: string;
  collection: string;
}

/**
 * Throws (or rejects) to refuse. `subject` is the record for `read`/`delete`, the
 * {@link MediaAttachTarget} for `attach`. `user` is what the caller passed, else `req.user`.
 */
export type MediaAuthorize = (
  user: unknown,
  action: MediaAction,
  subject: MediaRecord | MediaAttachTarget,
) => void | Promise<void>;

/**
 * A provider-style factory, resolved by Nest: how ORM helpers hand over a store that needs an
 * injected connection (`typeOrmMediaStore({ connectionName })`, `drizzleMediaStore(...)`).
 */
export interface MediaFactory<T> {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: any[]) => T | Promise<T>;
}

/**
 * Console labels keyed by tenant id: the context's `tenantLabels` (its `tenancy.label`, context >=
 * 2.1), else the slug, else the id. Read structurally, like the rest of the tenancy contract.
 */
async function labelTenants(
  tenants: Array<{ id: string; kind: string; slug?: string }>,
  injected: unknown,
): Promise<Record<string, string>> {
  const slot = (globalThis as unknown as Record<symbol, { current?: unknown } | undefined>)[
    Symbol.for('@dudousxd/nestjs-diagnostics:accessor')
  ];
  const accessor = (injected ?? slot?.current) as
    | { tenantLabels?(tenants: unknown[]): Promise<Record<string, string>> }
    | undefined;
  if (typeof accessor?.tenantLabels === 'function') {
    try {
      return await accessor.tenantLabels(tenants);
    } catch {
      // Fall back to slug/id below.
    }
  }
  return Object.fromEntries(tenants.map((t) => [t.id, t.slug || t.id]));
}

/**
 * The request's tenant scope, under `MEDIA_TENANCY`: what the media dashboard applies to the
 * stores it reads directly. Both methods switch the stores to tenancy first when it is on.
 */
export interface MediaTenancyScope {
  /** The store filter for this request: `undefined` when every row is visible. */
  match(): Promise<MediaTenantMatch | undefined>;
  /** Whether this request may see a row whose tenant is `tenantId`. */
  canSee(tenantId: string | null | undefined): Promise<boolean>;
  /**
   * Display labels keyed by tenant id (the context's `tenancy.label`, else the slug, else the id),
   * for the console. Empty while tenancy is off.
   */
  labels(tenantIds: string[]): Promise<Record<string, string>>;
  /**
   * With `tenancy.pathPrefix`, the storage prefix of this request's tenant (`t/<tenantId>/`);
   * otherwise `undefined`.
   */
  pathPrefix(): Promise<string | undefined>;
}

export interface MediaModuleOptions {
  /**
   * Scope media by the request's tenant (from `@dudousxd/nestjs-context`). Default `'inherit'`:
   * on only when `ContextModule` turns tenancy on (it is off by default). With tenancy on, uploads
   * and attaches are stamped with the tenant, and reads (`library`, `serve`, `url`, conversions,
   * upload sessions, the dashboard) only see that tenant's records; any other record is not found.
   * `false` keeps media out of tenancy. See the "Tenancy" docs page.
   */
  tenancy?: MediaTenancyOption;
  /**
   * Enable the media-library layer (layer 2) by providing a persistence store: an instance, or a
   * {@link MediaFactory} (e.g. `typeOrmMediaStore({ connectionName: 'media' })`).
   */
  store?: MediaStore | MediaFactory<MediaStore>;
  collections?: MediaCollectionConfig[];
  imageProcessor?: ImageProcessor;
  /** Enable resumable (proxy) uploads by providing a session store (instance or factory). */
  uploadSessions?: UploadSessionStore | MediaFactory<UploadSessionStore>;
  uploadTmpPrefix?: string;
  /**
   * Native multipart side-cars by disk name (a disk configured in `StorageModule`), e.g.
   * `{ s3: s3Multipart(s3Options) }` from `@dudousxd/nestjs-media-disk-s3`. Resumable uploads on
   * such a disk upload each chunk as a part; direct (presigned) uploads need one. A name that
   * isn't a configured disk fails at startup.
   */
  multipart?: MultipartDrivers;
  /**
   * Checks `MediaService.serve()`/`url()` (`read`), `attach()` and `delete()` before they act.
   * Throw to refuse. Not applied to `MediaService.library`, which stays the unchecked core API.
   *
   * ```ts
   * authorize: (user, action, record) => authorization.authorize(MediaPolicy, action, user, record)
   * ```
   */
  authorize?: MediaAuthorize;
  /** Mount the tus HTTP controller (requires uploadSessions). */
  tus?: MediaTusOptions;
  /** Mount the direct (S3 multipart presign) upload controller (requires a `multipart` side-car). */
  direct?: MediaDirectOptions;
  /**
   * Modules providing the dependencies of a guard you pass through `decorators` (e.g.
   * `UseGuards(AuthenticationGuard)`), or of a `store`/`uploadSessions` factory.
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

/**
 * What `forRootAsync`'s `useFactory` returns: every option. Static ones (`imports`, `decorators`,
 * `mount`, `routes`) are ignored there, and stores must be instances: a store needing injection
 * goes in `forRootAsync({ store })`.
 */
export type MediaModuleRuntimeOptions = MediaModuleOptions;

export interface MediaModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => MediaModuleRuntimeOptions | Promise<MediaModuleRuntimeOptions>;
  /**
   * A store built by Nest from injected dependencies (`typeOrmMediaStore({ connectionName })`).
   * Static, next to `useFactory`; it wins over a `store` the factory returns.
   */
  store?: MediaFactory<MediaStore>;
  /** As {@link MediaModuleAsyncOptions.store}, for the upload session store. */
  uploadSessions?: MediaFactory<UploadSessionStore>;
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

function isFactory<T>(value: T | MediaFactory<T> | undefined): value is MediaFactory<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<MediaFactory<T>>).useFactory === 'function'
  );
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

/** `Storage` from `StorageModule`, with a pointed error when the app didn't register it. */
/** @internal */
export function requireStorage(storage: Storage | null | undefined): Storage {
  if (!storage) {
    throw new Error(
      'MediaModule stores files on the disks of @nestjs/storage: register StorageModule.forRoot({ disks: { ... } }) ' +
        '(global by default) before MediaModule. See https://docs.nestjs.com/application/file-storage',
    );
  }
  return storage;
}

function checkMultipart(
  storage: Storage,
  multipart: MultipartDrivers | undefined,
): MultipartDrivers {
  const names = storage.names();
  for (const disk of Object.keys(multipart ?? {})) {
    if (!names.includes(disk)) {
      throw new Error(
        `MediaModule: \`multipart.${disk}\` names no StorageModule disk. Configured disks: ${names.join(', ') || 'none'}.`,
      );
    }
  }
  return multipart ?? {};
}

const STORAGE_DEP = { token: Storage, optional: true };
/** `@dudousxd/nestjs-context`'s `CONTEXT_ACCESSOR`, read structurally (no import, optional). */
const CONTEXT_DEP = { token: Symbol.for('@dudousxd/nestjs-context:accessor'), optional: true };

/** A store provider: the static factory when there is one, else the runtime option (or null). */
function storeProvider<T>(
  provide: symbol,
  factory: MediaFactory<T> | undefined,
  pick: (options: MediaModuleRuntimeOptions) => T | MediaFactory<T> | undefined,
): FactoryProvider {
  if (factory) {
    return { provide, inject: factory.inject ?? [], useFactory: factory.useFactory };
  }
  return {
    provide,
    inject: [MEDIA_OPTIONS],
    useFactory: (options: MediaModuleRuntimeOptions) => {
      const value = pick(options);
      if (isFactory(value)) {
        throw new Error(
          'MediaModule.forRootAsync: the factory returned a store factory ({ inject, useFactory }); ' +
            'pass it at the top level instead: MediaModule.forRootAsync({ store: ..., useFactory }).',
        );
      }
      return value ?? null;
    },
  };
}

/** Every provider, from the resolved options (`MEDIA_OPTIONS`) and the static store factories. */
function mediaProviders(
  optionsProvider: Provider,
  factories: {
    store?: MediaFactory<MediaStore>;
    uploadSessions?: MediaFactory<UploadSessionStore>;
  },
): Provider[] {
  return [
    optionsProvider,
    storeProvider(MEDIA_STORE, factories.store, (o) => o.store),
    storeProvider(MEDIA_UPLOAD_SESSIONS, factories.uploadSessions, (o) => o.uploadSessions),
    {
      provide: MEDIA_MULTIPART,
      inject: [STORAGE_DEP, MEDIA_OPTIONS],
      useFactory: (storage: Storage | null, options: MediaModuleRuntimeOptions) =>
        checkMultipart(requireStorage(storage), options.multipart),
    },
    {
      provide: MEDIA_LIBRARY,
      inject: [STORAGE_DEP, MEDIA_STORE, MEDIA_OPTIONS, CONTEXT_DEP],
      useFactory: (
        storage: Storage | null,
        store: MediaStore | null,
        options: MediaModuleRuntimeOptions,
        contextAccessor: unknown,
      ) =>
        store
          ? new MediaLibrary({
              storage: requireStorage(storage),
              store,
              ...(options.tenancy !== undefined ? { tenancy: options.tenancy } : {}),
              ...(contextAccessor ? { contextAccessor } : {}),
              ...(options.collections ? { collections: options.collections } : {}),
              ...(options.imageProcessor ? { imageProcessor: options.imageProcessor } : {}),
            })
          : null,
    },
    {
      provide: MEDIA_UPLOADS,
      inject: [STORAGE_DEP, MEDIA_UPLOAD_SESSIONS, MEDIA_MULTIPART, MEDIA_OPTIONS, CONTEXT_DEP],
      useFactory: (
        storage: Storage | null,
        sessions: UploadSessionStore | null,
        multipart: MultipartDrivers,
        options: MediaModuleRuntimeOptions,
        contextAccessor: unknown,
      ) =>
        sessions
          ? new ResumableUploadManager({
              storage: requireStorage(storage),
              sessions,
              multipart,
              ...(options.tenancy !== undefined ? { tenancy: options.tenancy } : {}),
              ...(contextAccessor ? { contextAccessor } : {}),
              ...(options.uploadTmpPrefix ? { tmpPrefix: options.uploadTmpPrefix } : {}),
            })
          : null,
    },
    {
      provide: MEDIA_TUS,
      inject: [MEDIA_UPLOADS, MEDIA_OPTIONS],
      useFactory: (uploads: ResumableUploadManager | null, options: MediaModuleRuntimeOptions) =>
        uploads && options.tus
          ? new TusUploadHandler({
              manager: uploads,
              disk: options.tus.disk,
              basePath: options.tus.basePath ?? '/media/uploads',
              ...(options.tus.maxSize ? { maxSize: options.tus.maxSize } : {}),
              ...(options.tus.keyFor ? { keyFor: options.tus.keyFor } : {}),
            })
          : null,
    },
    {
      provide: MEDIA_ATTACHMENTS,
      inject: [STORAGE_DEP, MEDIA_OPTIONS],
      useFactory: (storage: Storage | null, options: MediaModuleRuntimeOptions) =>
        new AttachmentManager({
          storage: requireStorage(storage),
          ...(options.imageProcessor ? { imageProcessor: options.imageProcessor } : {}),
        }),
    },
    {
      provide: MEDIA_DIRECT,
      inject: [STORAGE_DEP, MEDIA_MULTIPART, MEDIA_OPTIONS],
      useFactory: (
        storage: Storage | null,
        multipart: MultipartDrivers,
        options: MediaModuleRuntimeOptions,
      ) =>
        options.direct
          ? new DirectUploadManager({
              storage: requireStorage(storage),
              multipart,
              ...(options.direct.partSize ? { defaultPartSize: options.direct.partSize } : {}),
            })
          : null,
    },
    {
      provide: MEDIA_TENANCY,
      inject: [MEDIA_LIBRARY, MEDIA_UPLOADS, MEDIA_OPTIONS, CONTEXT_DEP],
      useFactory: (
        library: MediaLibrary | null,
        uploads: ResumableUploadManager | null,
        options: MediaModuleRuntimeOptions,
        contextAccessor: unknown,
      ): MediaTenancyScope => {
        const current = async () => {
          const tenancy = readTenancy(options.tenancy, contextAccessor ?? undefined);
          if (tenancy.enabled) {
            await library?.prepareTenancy();
            await uploads?.prepareTenancy();
          }
          return tenancy;
        };
        return {
          match: async () => tenantMatch(await current()),
          canSee: async (tenantId) => canSeeRow(await current(), tenantId),
          labels: async (tenantIds) => {
            const tenancy = readTenancy(options.tenancy, contextAccessor ?? undefined, {
              required: false,
            });
            if (!tenancy.enabled || tenantIds.length === 0) return {};
            // Rows keep only the id: label them as the kind media scopes by.
            const own = typeof options.tenancy === 'object' ? options.tenancy : {};
            const filter = tenancy.filter();
            const kind =
              own.kinds?.[0] ?? (filter.mode === 'tenant' ? filter.tenant.kind : 'tenant');
            return labelTenants(
              [...new Set(tenantIds)].map((id) => ({ id, kind })),
              contextAccessor,
            );
          },
          pathPrefix: async () => {
            const tenancy = await current();
            if (!tenancy.enabled || !tenancy.pathPrefix) return undefined;
            const filter = tenancy.filter();
            return filter.mode === 'tenant' ? `t/${keySegment(filter.tenant.id)}/` : undefined;
          },
        };
      },
    },
    MediaService,
  ];
}

const EXPORTS = [
  MediaService,
  MEDIA_LIBRARY,
  MEDIA_UPLOADS,
  MEDIA_TUS,
  MEDIA_ATTACHMENTS,
  MEDIA_DIRECT,
  MEDIA_STORE,
  MEDIA_UPLOAD_SESSIONS,
  MEDIA_MULTIPART,
  MEDIA_TENANCY,
];

/**
 * The media layer on `@nestjs/storage`: register `StorageModule.forRoot({ disks })` for the disks,
 * then `MediaModule.forRoot({ store, collections, ... })` for the media library, attachments and
 * resumable/direct uploads on them.
 */
@Global()
@Module({})
export class MediaModule {
  static forRoot(options: MediaModuleOptions): DynamicModule {
    const controllers = uploadControllers(options.decorators);
    const hasSessions = options.uploadSessions !== undefined;
    const mounted = [
      ...(hasSessions && options.tus && mounts(options, 'tus') ? [controllers.tus] : []),
      ...(hasSessions && mounts(options, 'multipart') ? [controllers.multipart] : []),
      ...(options.direct && mounts(options, 'direct') ? [controllers.direct] : []),
    ];
    assertUploadsProtected('MediaModule.forRoot', mounted, options.decorators);
    const { store, uploadSessions, imports, decorators, mount, routes, ...runtime } = options;
    const factories = {
      ...(isFactory(store) ? { store } : {}),
      ...(isFactory(uploadSessions) ? { uploadSessions } : {}),
    };
    const resolved: MediaModuleRuntimeOptions = {
      ...runtime,
      ...(store && !isFactory(store) ? { store } : {}),
      ...(uploadSessions && !isFactory(uploadSessions) ? { uploadSessions } : {}),
    };
    return {
      module: MediaModule,
      imports: imports ?? [],
      providers: mediaProviders({ provide: MEDIA_OPTIONS, useValue: resolved }, factories),
      controllers: mounted,
      exports: EXPORTS,
    };
  }

  static forRootAsync(options: MediaModuleAsyncOptions): DynamicModule {
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
      providers: mediaProviders(
        { provide: MEDIA_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        {
          ...(options.store ? { store: options.store } : {}),
          ...(options.uploadSessions ? { uploadSessions: options.uploadSessions } : {}),
        },
      ),
      // Unlike `forRoot`, async options are resolved at runtime by `useFactory`, so we cannot
      // know at module-build time whether `tus`/`direct` are configured. Each mounted controller
      // injects its nullable manager token and responds 501 when its feature is left unconfigured.
      // `mount` is the STATIC escape hatch for dropping a controller's routes entirely.
      controllers: mounted,
      exports: EXPORTS,
    };
  }
}
