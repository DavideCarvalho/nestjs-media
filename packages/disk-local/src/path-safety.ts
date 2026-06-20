import { isAbsolute, relative, resolve } from 'node:path';

/** Resolve `requestPath` under `root`, rejecting absolute paths and `..` escapes. */
export function resolveWithinRoot(root: string, requestPath: string): string {
  if (isAbsolute(requestPath)) {
    throw new Error(`Absolute paths are not allowed: ${requestPath}`);
  }
  const abs = resolve(root, requestPath);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes storage root: ${requestPath}`);
  }
  return abs;
}
