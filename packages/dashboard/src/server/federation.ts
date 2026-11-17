import { AsyncLocalStorage } from 'node:async_hooks';
import type { MediaStore, UploadSessionStore } from '@dudousxd/nestjs-media-core';
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Storage } from '@nestjs/storage';
import { Observable } from 'rxjs';

/**
 * Another app a federated console shows (see {@link MediaConsoleFederation}): the stores that app's
 * own `MediaModule` writes, read in place by this console. Nothing is shipped from the app, and the
 * app needs no change: point each handle at the app's database, Redis or bucket.
 */
export interface FederatedMediaApp {
  /**
   * The app's `MediaStore` (its media library): the Library and Collections pages, and the
   * "Delete record" action (a row delete, like on the console's own app). A handle with read
   * access is enough to browse; the delete needs `DELETE` on the media table. Omitted: the app
   * shows no library.
   */
  store?: MediaStore;
  /**
   * The app's `UploadSessionStore` (e.g. `RedisUploadSessionStore` on the app's Redis): the Uploads
   * page and "Cancel session" (removes the session record, like on the console's own app).
   * Omitted: the app shows no uploads.
   */
  uploads?: UploadSessionStore;
  /**
   * The app's disks, as a `Storage` from `@nestjs/storage` (`new Storage(new Map([['s3', disk]]),
   * 's3')`) over credentials that may read the app's buckets: the Disks page, previews and
   * downloads, and the library's variant URLs. Read-only: every disk write (upload, new folder,
   * delete, copy, move) answers 501 for a federated app, since it belongs to the app's own
   * process. Omitted: the app shows no disks.
   */
  storage?: Storage;
  /** Shown in the app switcher. Default: the app's name. */
  label?: string;
}

/**
 * The dashboard's `federation` option: one media console (typically on a central app) that also
 * shows the media of other apps, each kept in that app's own stores. The console gets an app
 * switcher, the selected app is in the URL (`?app=<name>`, sent to the API as the `x-media-app`
 * header), and every read and action of a request is served from that app's stores.
 */
export interface MediaConsoleFederation {
  /**
   * The other apps, by name: what `?app=` selects and what an `authorize` `apps` grant names. A
   * name is 1–100 characters of letters, digits, `.`, `_` and `-`.
   */
  apps: Record<string, FederatedMediaApp>;
  /** How the console's own app is labelled in the switcher. Default `'this app'`. */
  localLabel?: string;
}

/** What the switcher shows (`topology.federation`). Mirrored in the client's `Topology`. */
export interface MediaFederationDescription {
  /** The console's own app, or `null` when the viewer's `apps` grant does not include it. */
  local: { label: string } | null;
  /** The federated apps the viewer may select. */
  apps: Array<{ name: string; label: string }>;
  /** The federated app this request is for; absent for the console's own app. */
  current?: string;
}

/** DI token carrying the {@link MediaConsoleFederation} (`null`: no federation). */
export const MEDIA_DASHBOARD_FEDERATION: symbol = Symbol.for(
  '@dudousxd/nestjs-media-dashboard:federation',
);

/** The request header the console's client names the selected app in. */
export const FEDERATED_APP_HEADER = 'x-media-app';
/** The query parameter that names it where a header can't be sent (the page, `<img src>`, a download). */
export const FEDERATED_APP_PARAM = 'app';

/** Where the console guard leaves the viewer's `apps` grant (a list) for the scope interceptor. */
export const CONSOLE_APPS: symbol = Symbol.for('@dudousxd/nestjs-media-dashboard:console-apps');

/** The apps of an `authorize` `apps` grant that confines, or `undefined` for every app. */
export function grantedApps(grant: unknown): string[] | undefined {
  if (!Array.isArray(grant)) return undefined;
  return grant.filter((app): app is string => typeof app === 'string' && app !== '');
}

/** One console request's app: a federated one, or the console's own (`app` undefined). */
export interface MediaConsoleScope {
  federation: MediaConsoleFederation;
  /** The federated app the request is for (`undefined`: the console's own app). */
  app?: { name: string } & FederatedMediaApp;
  /** The viewer's `apps` grant (`undefined`: every app, the console's own included). */
  grant: readonly string[] | undefined;
}

const scopes = new AsyncLocalStorage<MediaConsoleScope>();

/** The scope of the running console request, when the console is federated. */
export function currentMediaConsoleScope(): MediaConsoleScope | undefined {
  return scopes.getStore();
}

/** The federated app the running console request is for, or `undefined` for the console's own. */
export function currentFederatedApp(): MediaConsoleScope['app'] {
  return scopes.getStore()?.app;
}

/** Runs `fn` inside `scope`. */
export function withMediaConsoleScope<T>(scope: MediaConsoleScope, fn: () => T): T {
  return scopes.run(scope, fn);
}

/**
 * Whether a viewer holding `grant` sees the console's own app: only without a list grant. A list
 * names the federated apps a viewer may select, and nothing else.
 */
export function seesLocalApp(grant: readonly string[] | undefined): boolean {
  return grant === undefined;
}

/** The app a console request selects (header first, then `?app=`), or `undefined` for none. */
export function selectedAppName(request: unknown): string | undefined {
  const req = request as
    | { headers?: Record<string, unknown>; query?: Record<string, unknown> }
    | undefined;
  const header = req?.headers?.[FEDERATED_APP_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader !== '') return fromHeader;
  const param = req?.query?.[FEDERATED_APP_PARAM];
  return typeof param === 'string' && param !== '' ? param : undefined;
}

const APP_NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** Throws at boot on a malformed `federation`. */
export function assertValidFederation(federation: MediaConsoleFederation | undefined): void {
  if (federation === undefined) return;
  const apps = federation?.apps;
  if (typeof apps !== 'object' || apps === null || Array.isArray(apps)) {
    throw new Error(
      'MediaDashboardModule: `federation.apps` must be an object of { [name]: { store?, uploads?, storage?, label? } }.',
    );
  }
  const localLabel = federation.localLabel;
  if (localLabel !== undefined && (typeof localLabel !== 'string' || localLabel === '')) {
    throw new Error('MediaDashboardModule: `federation.localLabel` must be a non-empty string.');
  }
  const names = Object.keys(apps);
  if (names.length === 0) throw new Error('MediaDashboardModule: `federation.apps` names no app.');
  for (const name of names) {
    if (!APP_NAME.test(name)) {
      throw new Error(
        `MediaDashboardModule: federation app name "${name}" must be 1–100 letters, digits, ".", "_" or "-".`,
      );
    }
    const app = apps[name];
    if (typeof app !== 'object' || app === null) {
      throw new Error(`MediaDashboardModule: \`federation.apps.${name}\` must be an object.`);
    }
    if (!app.store && !app.uploads && !app.storage) {
      throw new Error(
        `MediaDashboardModule: \`federation.apps.${name}\` needs at least one of \`store\`, \`uploads\` or \`storage\`.`,
      );
    }
    if (app.label !== undefined && (typeof app.label !== 'string' || app.label === '')) {
      throw new Error(
        `MediaDashboardModule: \`federation.apps.${name}.label\` must be a non-empty string.`,
      );
    }
  }
}

/** The switcher's view of `federation` for a viewer holding `grant`, answering for `current`. */
export function describeFederation(
  federation: MediaConsoleFederation,
  grant: readonly string[] | undefined,
  current: string | undefined,
): MediaFederationDescription {
  return {
    local: seesLocalApp(grant) ? { label: federation.localLabel ?? 'this app' } : null,
    apps: Object.entries(federation.apps)
      .filter(([name]) => grant === undefined || grant.includes(name))
      .map(([name, app]) => ({ name, label: app.label ?? name })),
    ...(current !== undefined ? { current } : {}),
  };
}

/**
 * Runs each console API handler for the app the request selects (`x-media-app` header or `?app=`),
 * on a federated console. The app must be configured and, under a list `apps` grant, named in it:
 * else the request answers 404, like an app that doesn't exist. No app selected is the console's
 * own app. A no-op on a console without `federation` (a stray `?app=` is ignored there).
 */
@Injectable()
export class MediaConsoleAppInterceptor implements NestInterceptor {
  constructor(
    @Optional()
    @Inject(MEDIA_DASHBOARD_FEDERATION)
    private readonly federation?: MediaConsoleFederation | null,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const federation = this.federation;
    if (!federation || context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Record<symbol, unknown> | undefined>();
    const grant = request?.[CONSOLE_APPS] as readonly string[] | undefined;
    const name = selectedAppName(request);
    let scope: MediaConsoleScope = { federation, grant };
    if (name !== undefined) {
      const app = Object.prototype.hasOwnProperty.call(federation.apps, name)
        ? federation.apps[name]
        : undefined;
      if (!app || (grant !== undefined && !grant.includes(name))) {
        throw new NotFoundException(`No app "${name}" on this console`);
      }
      scope = { federation, grant, app: { name, ...app } };
    }
    // Subscribing inside the scope runs the handler (and every async continuation it starts) in it.
    return new Observable((subscriber) =>
      withMediaConsoleScope(scope, () => next.handle().subscribe(subscriber)),
    );
  }
}
