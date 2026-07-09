import type {
  MultipartPart,
  UploadSession,
  UploadSessionListFilter,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';

export interface MinimalRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  /**
   * Cursor-based key scan (ioredis signature). Optional so existing minimal
   * adapters keep compiling — only `list()` requires it.
   */
  scan?(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]>;
  /** Hash field set (ioredis signature). Optional — only `addPart` requires it. */
  hset?(key: string, field: string, value: string): Promise<unknown>;
  /** Read all hash fields (ioredis signature). Optional — only `listParts` requires it. */
  hgetall?(key: string): Promise<Record<string, string>>;
  /** Set a key TTL in seconds (ioredis signature). Optional — bounds orphaned part hashes. */
  expire?(key: string, seconds: number): Promise<unknown>;
}

export interface RedisUploadSessionStoreOptions {
  keyPrefix?: string;
  ttlSeconds?: number;
}

function isUploadSession(value: unknown): value is UploadSession {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.disk !== 'string') return false;
  if (typeof obj.key !== 'string') return false;
  if (typeof obj.offset !== 'number') return false;
  if (typeof obj.parts !== 'number') return false;
  if (obj.contentType !== undefined && typeof obj.contentType !== 'string') return false;
  if (obj.size !== undefined && typeof obj.size !== 'number') return false;
  if (obj.multipartUploadId !== undefined && typeof obj.multipartUploadId !== 'string')
    return false;
  if (obj.createdAt !== undefined && typeof obj.createdAt !== 'string') return false;
  return true;
}

export class RedisUploadSessionStore implements UploadSessionStore {
  private readonly redis: MinimalRedis;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;

  constructor(redis: MinimalRedis, options: RedisUploadSessionStoreOptions = {}) {
    this.redis = redis;
    this.keyPrefix = options.keyPrefix ?? 'media:upload:session';
    this.ttlSeconds = options.ttlSeconds ?? 86400;
  }

  private key(id: string): string {
    return `${this.keyPrefix}:${id}`;
  }

  private partsKey(id: string): string {
    return `${this.keyPrefix}:${id}:parts`;
  }

  async create(session: UploadSession): Promise<UploadSession> {
    const toStore: UploadSession = { ...session, createdAt: session.createdAt ?? new Date() };
    await this.redis.set(this.key(toStore.id), JSON.stringify(toStore), 'EX', this.ttlSeconds);
    return { ...toStore };
  }

  private deserialize(raw: string): UploadSession | null {
    const parsed: unknown = JSON.parse(raw);
    if (!isUploadSession(parsed)) return null;
    const session: UploadSession = {
      id: parsed.id,
      disk: parsed.disk,
      key: parsed.key,
      offset: parsed.offset,
      parts: parsed.parts,
      contentType: parsed.contentType,
      size: parsed.size,
      ...(parsed.multipartUploadId !== undefined
        ? { multipartUploadId: parsed.multipartUploadId }
        : {}),
      ...(parsed.createdAt !== undefined ? { createdAt: new Date(parsed.createdAt) } : {}),
    };
    return session;
  }

  async get(id: string): Promise<UploadSession | null> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    return this.deserialize(raw);
  }

  /**
   * List the currently-stored (in-progress) upload sessions, optionally
   * filtered by disk and/or key prefix. Scans keys under `keyPrefix` — intended
   * for low-frequency, admin-facing "uploads in progress" views, not a hot path.
   * Requires the redis client to support `scan` (ioredis does).
   */
  async list(filter: UploadSessionListFilter = {}): Promise<UploadSession[]> {
    if (typeof this.redis.scan !== 'function') {
      throw new Error(
        'RedisUploadSessionStore.list() requires a redis client with a `scan` method (e.g. ioredis).',
      );
    }
    const match = `${this.keyPrefix}:*`;
    const sessions: UploadSession[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = next;
      for (const redisKey of keys) {
        const raw = await this.redis.get(redisKey);
        if (!raw) continue;
        const session = this.deserialize(raw);
        if (!session) continue;
        if (filter.disk !== undefined && session.disk !== filter.disk) continue;
        if (filter.keyPrefix !== undefined && !session.key.startsWith(filter.keyPrefix)) {
          continue;
        }
        sessions.push(session);
      }
    } while (cursor !== '0');
    return sessions;
  }

  async update(session: UploadSession): Promise<UploadSession> {
    await this.redis.set(this.key(session.id), JSON.stringify(session), 'EX', this.ttlSeconds);
    return { ...session };
  }

  async addPart(id: string, part: MultipartPart): Promise<void> {
    if (typeof this.redis.hset !== 'function') {
      throw new Error(
        'RedisUploadSessionStore.addPart() requires a redis client with `hset` (e.g. ioredis).',
      );
    }
    const partsKey = this.partsKey(id);
    await this.redis.hset(partsKey, String(part.partNumber), part.etag);
    // Bound orphaned part hashes (a crashed upload never reaching delete()).
    if (typeof this.redis.expire === 'function') {
      await this.redis.expire(partsKey, this.ttlSeconds);
    }
  }

  async listParts(id: string): Promise<MultipartPart[]> {
    if (typeof this.redis.hgetall !== 'function') {
      throw new Error(
        'RedisUploadSessionStore.listParts() requires a redis client with `hgetall` (e.g. ioredis).',
      );
    }
    const map = await this.redis.hgetall(this.partsKey(id));
    return Object.entries(map ?? {}).map(([partNumber, etag]) => ({
      partNumber: Number(partNumber),
      etag,
    }));
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(this.key(id), this.partsKey(id));
  }
}
