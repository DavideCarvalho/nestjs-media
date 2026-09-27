import type {
  MultipartPart,
  UploadSession,
  UploadSessionListFilter,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import type { DrizzlePgDatabase } from './db';
import { mediaUploadPartsPgTable, mediaUploadSessionsPgTable } from './schema';

type SessionRow = typeof mediaUploadSessionsPgTable.$inferSelect;

/** Escape `\`, `%` and `_` so a user-supplied prefix matches literally under `LIKE` (default escape `\`). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toSession(row: SessionRow): UploadSession {
  const session: UploadSession = {
    id: row.id,
    disk: row.disk,
    key: row.key,
    contentType: row.contentType ?? undefined,
    size: row.size == null ? undefined : Number(row.size),
    offset: Number(row.offset),
    parts: Number(row.parts),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  };
  if (row.multipartUploadId != null) session.multipartUploadId = row.multipartUploadId;
  if (row.metadata != null) session.metadata = row.metadata;
  return session;
}

function toColumns(session: UploadSession) {
  return {
    disk: session.disk,
    key: session.key,
    contentType: session.contentType ?? null,
    size: session.size ?? null,
    offset: session.offset,
    parts: session.parts,
    multipartUploadId: session.multipartUploadId ?? null,
    metadata: session.metadata ?? null,
  };
}

/**
 * `UploadSessionStore` (resumable uploads) backed by Drizzle on **PostgreSQL**. Implements every
 * optional method: `addPart` is a single atomic upsert on `(session_id, part_number)` so parallel
 * part uploads never lose an ETag; `delete` cascades to the parts via the FK.
 * Tables: `mediaUploadSessionsPgTable` + `mediaUploadPartsPgTable` (or `createMediaPgTables(db)`).
 */
export class DrizzlePgUploadSessionStore implements UploadSessionStore {
  constructor(private readonly db: DrizzlePgDatabase) {}

  async create(session: UploadSession): Promise<UploadSession> {
    const createdAt = session.createdAt ?? new Date();
    await this.db
      .insert(mediaUploadSessionsPgTable)
      .values({ id: session.id, ...toColumns(session), createdAt, updatedAt: new Date() });
    return { ...session, createdAt };
  }

  async get(id: string): Promise<UploadSession | null> {
    const rows = await this.db
      .select()
      .from(mediaUploadSessionsPgTable)
      .where(eq(mediaUploadSessionsPgTable.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async update(session: UploadSession): Promise<UploadSession> {
    const columns = {
      ...toColumns(session),
      ...(session.createdAt !== undefined ? { createdAt: session.createdAt } : {}),
      updatedAt: new Date(),
    };
    // Upsert, matching the in-memory store (update of an unknown id stores it).
    await this.db
      .insert(mediaUploadSessionsPgTable)
      .values({ id: session.id, ...columns })
      .onConflictDoUpdate({ target: mediaUploadSessionsPgTable.id, set: columns });
    return { ...session };
  }

  async delete(id: string): Promise<void> {
    // Parts go with it (`ON DELETE CASCADE`).
    await this.db.delete(mediaUploadSessionsPgTable).where(eq(mediaUploadSessionsPgTable.id, id));
  }

  async addPart(id: string, part: MultipartPart): Promise<void> {
    await this.db
      .insert(mediaUploadPartsPgTable)
      .values({ sessionId: id, partNumber: part.partNumber, etag: part.etag })
      .onConflictDoUpdate({
        target: [mediaUploadPartsPgTable.sessionId, mediaUploadPartsPgTable.partNumber],
        set: { etag: sql`excluded.etag` },
      });
  }

  async listParts(id: string): Promise<MultipartPart[]> {
    const rows = await this.db
      .select({
        partNumber: mediaUploadPartsPgTable.partNumber,
        etag: mediaUploadPartsPgTable.etag,
      })
      .from(mediaUploadPartsPgTable)
      .where(eq(mediaUploadPartsPgTable.sessionId, id))
      .orderBy(asc(mediaUploadPartsPgTable.partNumber));
    return rows.map((row) => ({ partNumber: Number(row.partNumber), etag: row.etag }));
  }

  async list(filter: UploadSessionListFilter = {}): Promise<UploadSession[]> {
    const conditions = [
      ...(filter.disk !== undefined ? [eq(mediaUploadSessionsPgTable.disk, filter.disk)] : []),
      ...(filter.keyPrefix !== undefined
        ? [like(mediaUploadSessionsPgTable.key, `${escapeLike(filter.keyPrefix)}%`)]
        : []),
    ];
    const rows = await this.db
      .select()
      .from(mediaUploadSessionsPgTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(mediaUploadSessionsPgTable.createdAt), asc(mediaUploadSessionsPgTable.id));
    return rows.map(toSession);
  }
}
