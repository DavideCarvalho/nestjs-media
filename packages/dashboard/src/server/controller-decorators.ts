import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { UseConsoleAuthorize } from './console-authorize.js';

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
 * in an app that adopts it. Who reaches these routes is decided by the console's `authorize` (and
 * any `decorators`): the guard treats `can-anyone` as open only when the route declares no `@Can()`,
 * so a `Can(...)` passed through `decorators` is still checked.
 */
export function OpenToAuthorization(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CAN_ANYONE_METADATA, true, target);
  };
}

/**
 * The controller class to mount for one console registration: a FRESH subclass per call, decorated
 * with the host's `decorators` and then with the console's own `authorize` guard and denial filter
 * (so the host's authentication guards run first and `request.user` is set). A fresh subclass,
 * like `@nestjs/mcp`'s `createMcpController`, because decorators like `UseGuards`/`Can` append to
 * the metadata of the class they're given: applying them to the shared class would leak one
 * registration's decorators into the next. The subclass inherits every route, parameter and DI
 * metadata from the original and keeps its name (for logs and `AuthorizationGuard`'s
 * `Class.handler` in denial events).
 */
export function consoleController<T extends Type>(
  controller: T,
  decorators: ClassDecorator[] | undefined,
): T {
  const Decorated = class extends (controller as Type) {} as unknown as T;
  Object.defineProperty(Decorated, 'name', { value: controller.name });
  // `Reflect.decorate` applies the list bottom-up, like stacked `@A @B class` decorators.
  if (decorators && decorators.length > 0) Reflect.decorate(decorators, Decorated);
  Reflect.decorate([UseConsoleAuthorize()], Decorated);
  return Decorated;
}
