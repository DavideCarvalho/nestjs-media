import 'reflect-metadata';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type ArgumentsHost,
  type CanActivate,
  Catch,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type Type,
  UseFilters,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';

// ── The contract (same names and shapes in every Aviary console) ─────────────────────────────────

export type ConsoleAuthorizeResult =
  | boolean
  | { allowed: true }
  | { allowed: false; reason?: 'unauthenticated' | 'forbidden' }
  | { redirectTo: string };

/** Class form: an `@Injectable()` provider (constructor injection works). */
export interface ConsoleAuthorizer {
  authorize(context: ExecutionContext): ConsoleAuthorizeResult | Promise<ConsoleAuthorizeResult>;
}
export type ConsoleAuthorizerClass = Type<ConsoleAuthorizer>;

/** `@nestjs/authorization` policy check: `policy[ability](user)`. */
export interface ConsolePolicyCheck {
  policy: Type<unknown>;
  ability: string;
}

export type ConsoleAuthorize =
  | ((context: ExecutionContext) => ConsoleAuthorizeResult | Promise<ConsoleAuthorizeResult>)
  | ConsoleAuthorizerClass
  | (() => Promise<{ default: ConsoleAuthorizerClass }>)
  | ConsolePolicyCheck
  | string;

export type ConsoleDecision =
  | { allowed: true }
  | { allowed: false; reason: 'unauthenticated' | 'forbidden'; redirectTo?: string };

/** The provider `@dudousxd/nestjs-authz`'s `AuthzModule` registers to resolve gate names. */
export const CONSOLE_GATE: symbol = Symbol.for('@dudousxd/aviary:console-gate');

/** What `@dudousxd/nestjs-authz` provides under {@link CONSOLE_GATE}. */
export interface ConsoleGate {
  allows(name: string, context: ExecutionContext): Promise<ConsoleAuthorizeResult>;
}

/** What a resolved `authorize` is: called once per request, never throws. */
export type ConsoleDecide = (context: ExecutionContext) => Promise<ConsoleDecision>;

const PACKAGE = '@dudousxd/nestjs-media-dashboard';
const MODULE = 'MediaDashboardModule';

/** The one boot warning for a console with no `authorize`. Same wording in every Aviary console. */
export const CONSOLE_AUTHORIZE_MISSING_WARNING = consoleAuthorizeMissingWarning(
  `${MODULE}.forRoot()`,
);

/** The boot warning naming the registration (`MediaConsoleApiModule.register()` when used alone). */
export function consoleAuthorizeMissingWarning(registration: string): string {
  return `[${PACKAGE}] console has no \`authorize\` configured: it is open outside production and denies every request in production. Set \`authorize\` in ${registration}.`;
}

// Every decision is a fresh object: a caller may mutate what it gets back.
const allow = (): ConsoleDecision => ({ allowed: true });
const forbidden = (): ConsoleDecision => ({ allowed: false, reason: 'forbidden' });
const unauthenticated = (): ConsoleDecision => ({ allowed: false, reason: 'unauthenticated' });

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

function isAuthorizerClass(value: unknown): value is ConsoleAuthorizerClass {
  return (
    typeof value === 'function' &&
    typeof (value as { prototype?: { authorize?: unknown } }).prototype?.authorize === 'function'
  );
}

function isPolicyCheck(value: unknown): value is ConsolePolicyCheck {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ConsolePolicyCheck).policy === 'function' &&
    typeof (value as ConsolePolicyCheck).ability === 'string'
  );
}

function isLazyModule(value: unknown): value is { default: ConsoleAuthorizerClass } {
  return (
    typeof value === 'object' &&
    value !== null &&
    isAuthorizerClass((value as { default?: unknown }).default)
  );
}

/** Turns any {@link ConsoleAuthorizeResult} into a {@link ConsoleDecision}. */
export function normalizeConsoleResult(result: unknown): ConsoleDecision {
  if (result === true) return allow();
  if (typeof result !== 'object' || result === null) return forbidden();
  const shape = result as { allowed?: unknown; reason?: unknown; redirectTo?: unknown };
  if (typeof shape.redirectTo === 'string' && shape.allowed !== true) {
    return { allowed: false, reason: 'unauthenticated', redirectTo: shape.redirectTo };
  }
  if (shape.allowed === true) return allow();
  return shape.reason === 'unauthenticated' ? unauthenticated() : forbidden();
}

/** `null`, `undefined` and `false` mean "nobody signed in", like `@nestjs/authorization`'s guard. */
function hasUser(user: unknown): boolean {
  return user !== null && user !== undefined && user !== false;
}

/** A dynamic import the bundler leaves alone, so the optional peer is never statically required. */
const importOptional = (specifier: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ specifier);

async function policyDecider(
  check: ConsolePolicyCheck,
  moduleRef: ModuleRef,
): Promise<ConsoleDecide> {
  let pkg: Record<string, unknown>;
  try {
    pkg = await importOptional('@nestjs/authorization');
  } catch {
    throw new Error(
      '`authorize: { policy, ability }` needs @nestjs/authorization installed (npm i @nestjs/authorization); or pass a function, a class, or a gate name',
    );
  }
  type Service = { can(policy: Type<unknown>, ability: string, user: unknown): Promise<boolean> };
  let service: Service | undefined;
  try {
    service = moduleRef.get<Service>(pkg.AuthorizationService as Type<Service>, { strict: false });
  } catch {
    service = undefined;
  }
  if (!service) {
    throw new Error(
      '`authorize: { policy, ability }` needs AuthorizationModule.forRoot() from @nestjs/authorization imported in the app',
    );
  }
  const found = service;
  const defaultGetUser = pkg.defaultGetUser as (context: ExecutionContext) => unknown;
  let getUser = defaultGetUser;
  try {
    const options = moduleRef.get<{ getUser?: typeof getUser } | undefined>(
      pkg.AUTHORIZATION_MODULE_OPTIONS as string,
      { strict: false },
    );
    if (typeof options?.getUser === 'function') getUser = options.getUser;
  } catch {
    // No module options registered: `defaultGetUser` reads `request.user`.
  }
  const { policy, ability } = check;
  return async (context) => {
    // `null`, `false` and `undefined` are a guest, as for `@nestjs/authorization`'s own guard.
    const user = await getUser(context);
    const signedIn = hasUser(user);
    if (await found.can(policy, ability, signedIn ? user : null)) return allow();
    return signedIn ? forbidden() : unauthenticated();
  };
}

function gateDecider(name: string, moduleRef: ModuleRef): ConsoleDecide {
  let gate: ConsoleGate | undefined;
  try {
    gate = moduleRef.get<ConsoleGate>(CONSOLE_GATE, { strict: false });
  } catch {
    gate = undefined;
  }
  if (!gate) {
    throw new Error(
      `\`authorize: '${name}'\` needs @dudousxd/nestjs-authz's AuthzModule (it resolves gate names); or pass a function, a class, or { policy, ability }`,
    );
  }
  const found = gate;
  return async (context) => normalizeConsoleResult(await found.allows(name, context));
}

function classDecider(moduleRef: ModuleRef): (Class: ConsoleAuthorizerClass) => ConsoleDecide {
  const instances = new Map<ConsoleAuthorizerClass, Promise<ConsoleAuthorizer>>();
  const instanceOf = (Class: ConsoleAuthorizerClass): Promise<ConsoleAuthorizer> => {
    const cached = instances.get(Class);
    if (cached) return cached;
    const pending = (async (): Promise<ConsoleAuthorizer> => {
      try {
        // A registered provider is used as is; otherwise one instance per registration.
        const registered = moduleRef.get(Class, { strict: false });
        if (registered) return registered;
      } catch {
        // Not a provider: create it below.
      }
      return moduleRef.create(Class);
    })();
    // A failed construction is retried on the next request instead of denying forever.
    pending.catch(() => instances.delete(Class));
    instances.set(Class, pending);
    return pending;
  };
  return (Class) => async (context) =>
    normalizeConsoleResult(await (await instanceOf(Class)).authorize(context));
}

/**
 * Resolves `authorize` into one function the guard calls per request. Configuration mistakes (a gate
 * name without nestjs-authz, a policy without @nestjs/authorization and its module) throw here, so
 * call it at boot. The returned function never throws: an error is a `forbidden`.
 *
 * `authorize` omitted: open outside production, `forbidden` for every request in production, and one
 * warning logged (unless `warnIfMissing: false`).
 */
export async function resolveConsoleAuthorize(
  authorize: ConsoleAuthorize | undefined,
  moduleRef: ModuleRef,
  options: { logger?: Logger; warnIfMissing?: boolean; registration?: string } = {},
): Promise<ConsoleDecide> {
  const logger = options.logger ?? new Logger(MODULE);
  if (authorize === undefined) {
    if (options.warnIfMissing !== false) {
      logger.warn(
        options.registration
          ? consoleAuthorizeMissingWarning(options.registration)
          : CONSOLE_AUTHORIZE_MISSING_WARNING,
      );
    }
    const production = isProduction();
    return async () => (production ? forbidden() : allow());
  }

  let decide: ConsoleDecide;
  if (typeof authorize === 'string') {
    decide = gateDecider(authorize, moduleRef);
  } else if (isPolicyCheck(authorize)) {
    decide = await policyDecider(authorize, moduleRef);
  } else if (isAuthorizerClass(authorize)) {
    decide = classDecider(moduleRef)(authorize);
  } else if (typeof authorize === 'function') {
    const fromClass = classDecider(moduleRef);
    let lazy: ConsoleDecide | undefined;
    const fn = authorize as (context: ExecutionContext) => unknown;
    decide = async (context) => {
      if (lazy) return lazy(context);
      const result = await fn(context);
      if (!isLazyModule(result)) return normalizeConsoleResult(result);
      // A lazy import: remember the class, so the import runs once per registration.
      lazy = fromClass(result.default);
      return lazy(context);
    };
  } else {
    throw new Error(
      `${MODULE}: \`authorize\` must be a function, a class with authorize(), a lazy import, { policy, ability } or a gate name.`,
    );
  }

  return async (context) => {
    try {
      return await decide(context);
    } catch (error) {
      logger.warn(
        `console \`authorize\` threw, denying the request: ${error instanceof Error ? error.message : String(error)}`,
      );
      return forbidden();
    }
  };
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Allows a request carrying `Authorization: Bearer <token>` (compared timing-safe); anything else
 * is `unauthenticated`. Header only: no query string, no custom header. Throws when `token` is
 * empty, so a missing env var fails at config time instead of opening the console.
 */
export function authorizeByToken(options: { token: string | undefined }): ConsoleAuthorize {
  const token = options.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('authorizeByToken: `token` is empty; set it (e.g. from an env var).');
  }
  const expected = sha256(token);
  return (context: ExecutionContext): ConsoleAuthorizeResult => {
    const header = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>()
      ?.headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
    if (match?.[1] && timingSafeEqual(sha256(match[1]), expected)) return true;
    return { allowed: false, reason: 'unauthenticated' };
  };
}

// ── Enforcement: a guard (decides) + a filter scoped to the console controllers (answers) ─────────

/** DI token of the resolved {@link ConsoleDecide} the guard runs. */
export const CONSOLE_AUTHORIZE_DECIDE: symbol = Symbol(`${PACKAGE}:console-authorize`);

/** Marks a controller as serving pages: a denied `GET` that accepts HTML gets a page, not JSON. */
export const CONSOLE_PAGE_METADATA = `${PACKAGE}:console-page`;
export const ConsolePage = (): ClassDecorator => (target) => {
  Reflect.defineMetadata(CONSOLE_PAGE_METADATA, true, target);
};

/**
 * The denial the guard throws. An `HttpException` with the JSON body, so it still answers correctly
 * where {@link ConsoleAuthorizeFilter} is not applied; the filter adds the page answers.
 */
export class ConsoleAccessDenied extends HttpException {
  constructor(
    readonly decision: Extract<ConsoleDecision, { allowed: false }>,
    /** Whether the denied request was a page navigation (answered with a redirect or a page). */
    readonly page = false,
  ) {
    const isUnauthenticated = decision.reason === 'unauthenticated';
    super(
      isUnauthenticated
        ? {
            error: 'unauthenticated',
            ...(decision.redirectTo ? { redirectTo: decision.redirectTo } : {}),
          }
        : { error: 'forbidden' },
      isUnauthenticated ? 401 : 403,
    );
  }
}

/**
 * Runs the console's `authorize` on every request to a console controller. The dashboard applies it
 * (after your `decorators`, so your authentication guards set `request.user` first); on controllers
 * you mount yourself (`routes: false`) apply {@link UseConsoleAuthorize}.
 */
@Injectable()
export class ConsoleAuthorizeGuard implements CanActivate {
  constructor(@Inject(CONSOLE_AUTHORIZE_DECIDE) private readonly decide: ConsoleDecide) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const decision = await this.decide(context);
    if (decision.allowed) return true;
    throw new ConsoleAccessDenied(decision, isPageNavigation(context));
  }
}

/** A `GET` asking for HTML on a console page controller: a browser navigation, not an API call. */
function isPageNavigation(context: ExecutionContext): boolean {
  if (context.getType() !== 'http') return false;
  if (Reflect.getMetadata(CONSOLE_PAGE_METADATA, context.getClass()) !== true) return false;
  const request = context
    .switchToHttp()
    .getRequest<{ method?: string; headers?: Record<string, unknown> }>();
  const accept = request?.headers?.accept;
  return request?.method === 'GET' && typeof accept === 'string' && accept.includes('text/html');
}

const page = (title: string, message: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0"><main style="text-align:center"><h1>${title}</h1><p>${message}</p></main></body></html>`;

const DENIED_PAGE = page('Access denied', 'You do not have access to this console.');
const SIGN_IN_PAGE = page('Sign in required', 'Sign in to use this console.');

/**
 * Answers a console denial: JSON for API calls; for a page navigation a 302 to `redirectTo`, an
 * "Access denied" page (403) or a "Sign in required" page (401).
 */
@Catch(ConsoleAccessDenied)
export class ConsoleAuthorizeFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: ConsoleAccessDenied, host: ArgumentsHost): void {
    const adapter = this.adapterHost.httpAdapter;
    const response = host.switchToHttp().getResponse();
    const { decision, page: isPage } = exception;
    if (isPage && decision.redirectTo) {
      adapter.redirect(response, 302, decision.redirectTo);
      return;
    }
    if (isPage) {
      const unauthenticated = decision.reason === 'unauthenticated';
      adapter.setHeader(response, 'Content-Type', 'text/html; charset=utf-8');
      adapter.reply(
        response,
        unauthenticated ? SIGN_IN_PAGE : DENIED_PAGE,
        unauthenticated ? 401 : 403,
      );
      return;
    }
    adapter.reply(response, exception.getResponse(), exception.getStatus());
  }
}

/**
 * The guard and its filter as one class decorator, for a console you mount yourself
 * (`routes: false`). List it ABOVE your authentication guards, so it runs after them.
 */
export const UseConsoleAuthorize = (): ClassDecorator & MethodDecorator =>
  applyDecorators(UseGuards(ConsoleAuthorizeGuard), UseFilters(ConsoleAuthorizeFilter));

/**
 * The provider of {@link CONSOLE_AUTHORIZE_DECIDE} for one registration: `authorize` resolved at boot
 * (one warning when it is omitted, whether or not the routes are mounted).
 */
export function consoleAuthorizeProvider(
  authorize: ConsoleAuthorize | undefined,
  registration: string,
): {
  provide: symbol;
  inject: [typeof ModuleRef];
  useFactory: (moduleRef: ModuleRef) => Promise<ConsoleDecide>;
} {
  return {
    provide: CONSOLE_AUTHORIZE_DECIDE,
    inject: [ModuleRef],
    useFactory: (moduleRef) => resolveConsoleAuthorize(authorize, moduleRef, { registration }),
  };
}
