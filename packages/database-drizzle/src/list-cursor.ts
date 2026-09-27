import type { MediaRecord } from '@dudousxd/nestjs-media-core';

/** Opaque keyset cursor over `(createdAt, id)`. Mirrors the in-memory store's encoding. */
export function encodeListCursor(record: MediaRecord): string {
  return Buffer.from(`${record.createdAt.toISOString()}|${record.id}`, 'utf8').toString('base64');
}

export interface DecodedListCursor {
  createdAt: Date;
  id: string;
}

export function decodeListCursor(cursor: string): DecodedListCursor | null {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  const createdAt = new Date(decoded.slice(0, separator));
  if (Number.isNaN(createdAt.getTime())) return null;
  const id = decoded.slice(separator + 1);
  return { createdAt, id };
}
