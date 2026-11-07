import 'reflect-metadata';
import type { Type } from '@nestjs/common';

/**
 * `@nestjs/authorization`'s `CAN_ANYONE_METADATA` key (what `@Can.Anyone()` writes), inlined as a
 * literal: that package doesn't export the constant, and this library doesn't depend on it. A spec
 * asserts the real `Can.Anyone()` writes this exact key, so upstream drift fails loudly.
 */
export const CAN_ANYONE_METADATA = 'authorization:can-anyone';

/**
 * Marks a controller open to `@nestjs/authorization`'s global `AuthorizationGuard`, the way
 * `@Can.Anyone()` would, without a dependency on that package. That guard denies a route that
 * declares no requirement, so without this mark every route this library mounts would be refused
 * in an app that adopts it. Who reaches these routes is decided by the host — its `decorators`, or
 * its own subclasses with `routes: false`: the guard treats `can-anyone` as open only when the
 * route declares no `@Can()`, so a `Can(...)` passed through `decorators` is still checked.
 */
export function OpenToAuthorization(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CAN_ANYONE_METADATA, true, target);
  };
}

/**
 * The controller class to mount for one module registration. With no `decorators`, the library's
 * own class itself (so `app.get(MediaUploadController)` keeps working). With some, a FRESH
 * subclass per call, decorated with them — the same approach as `@nestjs/mcp`'s
 * `createMcpController`: decorators like `UseGuards`/`Can` append to the metadata of the class
 * they're given, so applying them to the shared class would leak one registration's decorators
 * into the next. The subclass inherits every route, parameter and DI metadata from the original
 * and keeps its name (for logs and `AuthorizationGuard`'s `Class.handler` in denial events).
 */
export function decoratedController<T extends Type>(
  controller: T,
  decorators: ClassDecorator[] | undefined,
): T {
  if (!decorators || decorators.length === 0) return controller;
  const Decorated = class extends (controller as Type) {} as unknown as T;
  Object.defineProperty(Decorated, 'name', { value: controller.name });
  // `Reflect.decorate` applies the list bottom-up, like stacked `@A @B class` decorators.
  return Reflect.decorate(decorators, Decorated) as T;
}

/** What {@link assertRoutesProtected} needs to say which module refused to boot, and how to fix it. */
export interface UnprotectedRoutesCheck {
  /** The module, as the host wrote it, e.g. `'MediaDashboardModule.forRoot'`. */
  module: string;
  /** Whether the registration mounts any controller at all. */
  mountsRoutes: boolean;
  decorators: ClassDecorator[] | undefined;
  /** One line showing `decorators` for this module. */
  decoratorsExample: string;
  /** One line showing `routes: false` + an extended controller for this module. */
  selfMountExample: string;
}

/**
 * The safe default: in production (`NODE_ENV === 'production'`), a registration that mounts routes
 * with no `decorators` (an empty list counts as none) refuses to boot, naming both ways to protect
 * them. Outside production the routes mount open, as before.
 */
export function assertRoutesProtected(check: UnprotectedRoutesCheck): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!check.mountsRoutes) return;
  if (check.decorators !== undefined && check.decorators.length > 0) return;
  throw new Error(
    [
      `${check.module}() mounts routes with no protection, which is refused when NODE_ENV=production. Protect them one of two ways:`,
      `  1. decorators on the mounted controllers: ${check.decoratorsExample}`,
      `  2. routes: false, and mount them yourself: ${check.selfMountExample}`,
    ].join('\n'),
  );
}
