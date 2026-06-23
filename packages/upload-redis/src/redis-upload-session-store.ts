import type { UploadSession, UploadSessionStore } from '@dudousxd/nestjs-media-core';

export interface MinimalRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
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

  async create(session: UploadSession): Promise<UploadSession> {
    await this.redis.set(this.key(session.id), JSON.stringify(session), 'EX', this.ttlSeconds);
    return { ...session };
  }

  async get(id: string): Promise<UploadSession | null> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
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
    };
    return session;
  }

  async update(session: UploadSession): Promise<UploadSession> {
    await this.redis.set(this.key(session.id), JSON.stringify(session), 'EX', this.ttlSeconds);
    return { ...session };
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(this.key(id));
  }
}
