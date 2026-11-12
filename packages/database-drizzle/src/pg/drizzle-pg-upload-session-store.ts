import type {
  MultipartPart,
  UploadSession,
  UploadSessionListFilter,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { and, asc, eq, getTableColumns, like, sql } from 'drizzle-orm';
import { assertTenantColumn, selectable, tenantCondition } from '../tenancy';
import type { DrizzlePgDatabase } from './db';
import type { DrizzlePgStoreOptions } from './drizzle-pg-media-store';
import { type MediaPgTables, mediaPgTables, type mediaUploadSessionsPgTable } from './schema';

type SessionRow = Omit<typeof mediaUploadSessionsPgTable.$inferSelect, 'tenantId'> & {
  tenantId?: string | null;
};

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
  if (row.tenantId !== undefined) session.tenantId = row.tenantId;
  return session;
}

function toColumns(session: UploadSession, tenancy: boolean) {
  return {
    ...(tenancy ? { tenantId: session.tenantId ?? null } : {}),
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
  private tenancy = false;

  private readonly t: MediaPgTables;

  /**
   * `schema`: the Postgres schema of `media_upload_sessions` / `media_upload_parts`. Every
   * statement names it (`search_path` is never used). Default: unqualified.
   */
  constructor(
    private readonly db: DrizzlePgDatabase,
    options: DrizzlePgStoreOptions = {},
  ) {
    this.t = mediaPgTables(options.schema);
  }

  /** Off: the table without `tenant_id`, which Drizzle would otherwise list in an INSERT. */
  private get sessionsTable() {
    return this.tenancy ? this.t.uploadSessions : this.t.uploadSessionsWithoutTenant;
  }

  /** The columns to read: `tenant_id` only once tenancy is on. */
  private get columns() {
    return selectable(getTableColumns(this.t.uploadSessions), this.tenancy);
  }

  /**
   * Tenancy: checks the `tenant_id` column exists, then reads and writes it. Called by the upload
   * manager when tenancy is on; until then the column is never touched.
   */
  async enableTenancy(): Promise<void> {
    await assertTenantColumn(
      'media_upload_sessions',
      () =>
        this.db
          .select({ tenantId: this.t.uploadSessions.tenantId })
          .from(this.t.uploadSessions)
          .limit(1),
      'Generate a migration with drizzle-kit from `this.t.uploadSessions` (it declares `tenant_id` and its index), or run `ALTER TABLE media_upload_sessions ADD COLUMN tenant_id text; CREATE INDEX idx_media_upload_sessions_tenant ON media_upload_sessions (tenant_id);`.',
    );
    this.tenancy = true;
  }

  /** The session as persisted: off, no `tenantId`; on, `tenantId` or `null`. */
  private persisted(session: UploadSession): UploadSession {
    const { tenantId, ...rest } = session;
    return this.tenancy ? { ...rest, tenantId: tenantId ?? null } : rest;
  }

  async create(session: UploadSession): Promise<UploadSession> {
    const createdAt = session.createdAt ?? new Date();
    await this.db.insert(this.sessionsTable).values({
      id: session.id,
      ...toColumns(session, this.tenancy),
      createdAt,
      updatedAt: new Date(),
    });
    return { ...this.persisted(session), createdAt };
  }

  async get(id: string): Promise<UploadSession | null> {
    const rows = await this.db
      .select(this.columns)
      .from(this.t.uploadSessions)
      .where(eq(this.t.uploadSessions.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async update(session: UploadSession): Promise<UploadSession> {
    const columns = {
      ...toColumns(session, this.tenancy),
      ...(session.createdAt !== undefined ? { createdAt: session.createdAt } : {}),
      updatedAt: new Date(),
    };
    // Upsert, matching the in-memory store (update of an unknown id stores it).
    await this.db
      .insert(this.sessionsTable)
      .values({ id: session.id, ...columns })
      .onConflictDoUpdate({ target: this.t.uploadSessions.id, set: columns });
    return this.persisted(session);
  }

  async delete(id: string): Promise<void> {
    // Parts go with it (`ON DELETE CASCADE`).
    await this.db.delete(this.t.uploadSessions).where(eq(this.t.uploadSessions.id, id));
  }

  async addPart(id: string, part: MultipartPart): Promise<void> {
    await this.db
      .insert(this.t.uploadParts)
      .values({ sessionId: id, partNumber: part.partNumber, etag: part.etag })
      .onConflictDoUpdate({
        target: [this.t.uploadParts.sessionId, this.t.uploadParts.partNumber],
        set: { etag: sql`excluded.etag` },
      });
  }

  async listParts(id: string): Promise<MultipartPart[]> {
    const rows = await this.db
      .select({
        partNumber: this.t.uploadParts.partNumber,
        etag: this.t.uploadParts.etag,
      })
      .from(this.t.uploadParts)
      .where(eq(this.t.uploadParts.sessionId, id))
      .orderBy(asc(this.t.uploadParts.partNumber));
    return rows.map((row) => ({ partNumber: Number(row.partNumber), etag: row.etag }));
  }

  async list(filter: UploadSessionListFilter = {}): Promise<UploadSession[]> {
    const conditions = [
      ...(filter.disk !== undefined ? [eq(this.t.uploadSessions.disk, filter.disk)] : []),
      ...(filter.keyPrefix !== undefined
        ? [like(this.t.uploadSessions.key, `${escapeLike(filter.keyPrefix)}%`)]
        : []),
      ...(filter.tenant ? [tenantCondition(this.t.uploadSessions.tenantId, filter.tenant)] : []),
    ];
    const rows = await this.db
      .select(this.columns)
      .from(this.t.uploadSessions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(this.t.uploadSessions.createdAt), asc(this.t.uploadSessions.id));
    return rows.map(toSession);
  }
}
