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
} from '@nestjs/common';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { MEDIA_CONSOLE_AUTHORIZE } from './tokens.js';

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

interface ConsoleGate {
  allows(name: string, context: ExecutionContext): Promise<ConsoleAuthorizeResult>;
}

const logger = new Logger('MediaDashboardModule');
const FORBIDDEN: ConsoleDecision = { allowed: false, reason: 'forbidden' };

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

/** Turns any {@link ConsoleAuthorizeResult} into a {@link ConsoleDecision}. */
export function normalizeConsoleDecision(result: unknown): ConsoleDecision {
  if (result === true) return { allowed: true };
  if (typeof result === 'object' && result !== null) {
    const r = result as { allowed?: unknown; reason?: unknown; redirectTo?: unknown };
    if (typeof r.redirectTo === 'string') {
      return { allowed: false, reason: 'unauthenticated', redirectTo: r.redirectTo };
    }
    if (r.allowed === true) return { allowed: true };
    if (r.allowed === false && r.reason === 'unauthenticated') {
      return { allowed: false, reason: 'unauthenticated' };
    }
  }
  return FORBIDDEN;
}

/** A dynamic import the bundler leaves alone, so the optional peer is never statically required. */
const importOptional = (specifier: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ specifier);

/**
 * Resolves `authorize` once, at module init, into a per-request check that never throws (a throw
 * inside it is a `forbidden` denial). A gate name with no gate provider, or a policy check without
 * `@nestjs/authorization` installed, throws here, at boot.
 */
export async function resolveConsoleAuthorize(
  authorize: ConsoleAuthorize,
  moduleRef: ModuleRef,
): Promise<(context: ExecutionContext) => Promise<ConsoleDecision>> {
  const guarded =
    (run: (context: ExecutionContext) => Promise<unknown>) =>
    async (context: ExecutionContext): Promise<ConsoleDecision> => {
      try {
        return normalizeConsoleDecision(await run(context));
      } catch (error) {
        logger.warn(
          `console \`authorize\` threw, so the request is denied: ${error instanceof Error ? error.message : String(error)}`,
        );
        return FORBIDDEN;
      }
    };

  if (typeof authorize === 'string') {
    let gate: ConsoleGate | undefined;
    try {
      gate = moduleRef.get<ConsoleGate>(CONSOLE_GATE, { strict: false });
    } catch {
      gate = undefined;
    }
    if (!gate) {
      throw new Error(
        `\`authorize: '${authorize}'\` needs @dudousxd/nestjs-authz's AuthzModule (it resolves gate names); or pass a function, a class, or { policy, ability }`,
      );
    }
    const found = gate;
    return guarded((context) => found.allows(authorize, context));
  }

  if (isPolicyCheck(authorize)) {
    let pkg: Record<string, unknown>;
    try {
      pkg = await importOptional('@nestjs/authorization');
    } catch {
      throw new Error(
        '`authorize: { policy, ability }` needs @nestjs/authorization installed (npm i @nestjs/authorization); or pass a function, a class, or a gate name',
      );
    }
    const service = moduleRef.get(pkg.AuthorizationService as Type, { strict: false }) as {
      can(policy: Type<unknown>, ability: string, user: unknown): Promise<boolean>;
    };
    let getUser = pkg.defaultGetUser as (context: ExecutionContext) => unknown;
    try {
      const options = moduleRef.get<{ getUser?: typeof getUser } | undefined>(
        pkg.AUTHORIZATION_MODULE_OPTIONS as string,
        { strict: false },
      );
      if (options?.getUser) getUser = options.getUser;
    } catch {
      // No module options registered: `defaultGetUser` reads `request.user`.
    }
    const { policy, ability } = authorize;
    return guarded(async (context) => {
      const user = await getUser(context);
      if (await service.can(policy, ability, user)) return true;
      const anonymous = user === null || user === undefined || user === false;
      return { allowed: false, reason: anonymous ? 'unauthenticated' : 'forbidden' };
    });
  }

  let instance: ConsoleAuthorizer | undefined;
  const instanceOf = async (Class: ConsoleAuthorizerClass): Promise<ConsoleAuthorizer> => {
    if (instance) return instance;
    try {
      instance = moduleRef.get(Class, { strict: false });
    } catch {
      instance = undefined;
    }
    instance ??= await moduleRef.create(Class);
    return instance;
  };

  if (isAuthorizerClass(authorize)) {
    return guarded(async (context) => (await instanceOf(authorize)).authorize(context));
  }

  const fn = authorize as (context: ExecutionContext) => unknown;
  let lazyClass: ConsoleAuthorizerClass | undefined;
  return guarded(async (context) => {
    if (lazyClass) return (await instanceOf(lazyClass)).authorize(context);
    const result = await fn(context);
    const loaded = (result as { default?: unknown } | null | undefined)?.default;
    if (typeof result === 'object' && result !== null && isAuthorizerClass(loaded)) {
      lazyClass = loaded;
      return (await instanceOf(loaded)).authorize(context);
    }
    return result;
  });
}

/**
 * `authorize` from a shared token: allows when `Authorization: Bearer <token>` matches (timing-safe),
 * otherwise answers `unauthenticated`. The header only — no query string, no custom header.
 */
export function authorizeByToken(options: { token: string | undefined }): (
  context: ExecutionContext,
) => ConsoleAuthorizeResult {
  const token = options.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('authorizeByToken({ token }) needs a non-empty token');
  }
  const expected = createHash('sha256').update(token).digest();
  return (context) => {
    const header = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>()
      .headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
    if (!match) return { allowed: false, reason: 'unauthenticated' };
    const given = createHash('sha256')
      .update(match[1] as string)
      .digest();
    return timingSafeEqual(given, expected)
      ? { allowed: true }
      : { allowed: false, reason: 'unauthenticated' };
  };
}

// ── Enforcement ──────────────────────────────────────────────────────────────────────────────────

/** The per-registration check the guard runs, bound to {@link MEDIA_CONSOLE_AUTHORIZE}. */
export type ConsoleAuthorizeCheck = (context: ExecutionContext) => Promise<ConsoleDecision>;

/** Marks a controller whose GET routes are page navigations (the SPA shell). */
export const CONSOLE_PAGE_METADATA = 'media-console:page';

/** A console denial; its response body is the JSON every API caller gets. */
export class ConsoleAccessDeniedException extends HttpException {
  constructor(
    readonly decision: Extract<ConsoleDecision, { allowed: false }>,
    /** Whether the denied request was a page navigation (answered with a redirect or a page). */
    readonly page = false,
  ) {
    super(
      decision.reason === 'unauthenticated'
        ? {
            error: 'unauthenticated',
            ...(decision.redirectTo ? { redirectTo: decision.redirectTo } : {}),
          }
        : { error: 'forbidden' },
      decision.reason === 'unauthenticated' ? 401 : 403,
    );
  }
}

/**
 * Runs the console's `authorize` on every request to a console controller. The dashboard applies it
 * (after your `decorators`, so your authentication guards set `request.user` first); apply it
 * yourself, with {@link ConsoleAuthorizeFilter}, on controllers you mount with `routes: false`.
 */
@Injectable()
export class ConsoleAuthorizeGuard implements CanActivate {
  constructor(@Inject(MEDIA_CONSOLE_AUTHORIZE) private readonly check: ConsoleAuthorizeCheck) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const decision = await this.check(context);
    if (decision.allowed) return true;
    throw new ConsoleAccessDeniedException(decision, isPageNavigation(context));
  }
}

const DENIED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Access denied</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0"><main style="text-align:center"><h1>Access denied</h1><p>You don't have access to the media console.</p></main></body></html>`;

/**
 * Answers a console denial: JSON for API calls; for a page navigation (`GET` with `Accept: text/html`
 * on the console page) a 302 to `redirectTo`, or an "Access denied" page.
 */
@Catch(ConsoleAccessDeniedException)
export class ConsoleAuthorizeFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: ConsoleAccessDeniedException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const adapter = this.adapterHost.httpAdapter;
    const { decision, page: isPage } = exception;
    if (isPage && decision.redirectTo) {
      adapter.redirect(response, 302, decision.redirectTo);
      return;
    }
    if (isPage && decision.reason === 'forbidden') {
      adapter.setHeader(response, 'Content-Type', 'text/html; charset=utf-8');
      adapter.reply(response, DENIED_PAGE, 403);
      return;
    }
    adapter.reply(response, exception.getResponse(), exception.getStatus());
  }
}

/** A `GET` asking for HTML on the console page controller — a browser navigation, not an API call. */
function isPageNavigation(context: ExecutionContext): boolean {
  if (context.getType() !== 'http') return false;
  const request = context
    .switchToHttp()
    .getRequest<{ method?: string; headers?: Record<string, unknown> }>();
  const accept = request.headers?.accept;
  return (
    request.method === 'GET' &&
    typeof accept === 'string' &&
    accept.includes('text/html') &&
    Reflect.getMetadata(CONSOLE_PAGE_METADATA, context.getClass()) === true
  );
}

/** The boot warning for a console with no `authorize`. */
export const NO_AUTHORIZE_WARNING = (module: string): string =>
  `[@dudousxd/nestjs-media-dashboard] console has no \`authorize\` configured: it is open outside production and denies every request in production. Set \`authorize\` in ${module}().`;

/**
 * The provider of {@link MEDIA_CONSOLE_AUTHORIZE} for one registration. With `authorize`, its resolved
 * check; without, open outside production and `forbidden` in production, with one boot warning.
 */
export function consoleAuthorizeProvider(
  authorize: ConsoleAuthorize | undefined,
  module: string,
): {
  provide: symbol;
  inject: [typeof ModuleRef];
  useFactory: (moduleRef: ModuleRef) => Promise<ConsoleAuthorizeCheck>;
} {
  return {
    provide: MEDIA_CONSOLE_AUTHORIZE,
    inject: [ModuleRef],
    useFactory: async (moduleRef) => {
      if (authorize !== undefined) return resolveConsoleAuthorize(authorize, moduleRef);
      logger.warn(NO_AUTHORIZE_WARNING(module));
      const decision: ConsoleDecision =
        process.env.NODE_ENV === 'production' ? FORBIDDEN : { allowed: true };
      return async () => decision;
    },
  };
}
