import 'reflect-metadata';
import type { CanActivate, Type } from '@nestjs/common';

/**
 * `@nestjs/common`'s own `GUARDS_METADATA` key, INLINED rather than deep-imported from
 * '@nestjs/common/constants' — that subpath has no extension and a strict ESM resolver (which the
 * built dual ESM/CJS output of this package is loaded under) 404s on it. Same convention as
 * `@dudousxd/nestjs-agent`'s `agent-dashboard.module.ts` and `@dudousxd/nestjs-telescope`'s
 * `telescope.module.ts`. A drift spec imports the real constant (via the resolvable
 * `'@nestjs/common/constants.js'` subpath) and asserts this literal stays byte-identical to it.
 */
export const GUARDS_METADATA = '__guards__';

/**
 * Narrows a `guards` entry to a class (constructor) as opposed to an already-instantiated
 * `CanActivate`. Only a class needs a DI provider so Nest can instantiate it — an instance is used
 * by the guards consumer as-is.
 */
export function isGuardClass(guard: Type<CanActivate> | CanActivate): guard is Type<CanActivate> {
  return typeof guard === 'function';
}

/**
 * Reads a controller's OWN `@UseGuards` metadata (not the inherited/prototype-chain one), or `[]`
 * when it carries none. MUST be called at module-load time — i.e. assigned to a top-level
 * `const` right after importing the controller — so it captures the pristine, decorator-defined
 * baseline BEFORE any `stampGuards` call below can mutate it.
 */
export function baseGuards(controller: Type): Array<Type<CanActivate> | CanActivate> {
  return Reflect.getOwnMetadata(GUARDS_METADATA, controller) ?? [];
}

/**
 * Stamp host guards onto a console controller — appending to each entry's captured `base` (its
 * own pristine `@UseGuards` metadata, or `[]` when it has none), never to whatever is CURRENTLY
 * stamped on the class. This package does not rebuild its controllers as a fresh subclass per
 * `forRoot`/`forRootAsync` call (unlike `@dudousxd/nestjs-telescope`'s `dynamicController`), so
 * appending onto LIVE metadata would compound across repeated calls against the same static class
 * (e.g. two tests in one file each calling `forRoot` with different `guards`). Recomputing from the
 * captured `base` every time keeps each call's result exactly `[...base, ...guards]`, independent of
 * whatever a prior call stamped.
 *
 * A no-op when `guards` is omitted/empty, leaving every controller's metadata exactly as its
 * decorator (or the absence of one) left it — so omitting `guards` reproduces today's behavior
 * byte-for-byte.
 */
export function stampGuards(
  guards: Array<Type<CanActivate> | CanActivate> | undefined,
  entries: Array<[controller: Type, base: Array<Type<CanActivate> | CanActivate>]>,
): void {
  if (guards === undefined || guards.length === 0) return;
  for (const [controller, base] of entries) {
    Reflect.defineMetadata(GUARDS_METADATA, [...base, ...guards], controller);
  }
}
