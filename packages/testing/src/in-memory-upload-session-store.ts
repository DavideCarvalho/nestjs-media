import type { UploadSession, UploadSessionStore } from '@dudousxd/nestjs-media-core';

/** In-memory UploadSessionStore for tests. */
export class InMemoryUploadSessionStore implements UploadSessionStore {
  private readonly sessions = new Map<string, UploadSession>();

  async create(session: UploadSession): Promise<UploadSession> {
    this.sessions.set(session.id, { ...session });
    return { ...session };
  }

  async get(id: string): Promise<UploadSession | null> {
    const found = this.sessions.get(id);
    return found ? { ...found } : null;
  }

  async update(session: UploadSession): Promise<UploadSession> {
    this.sessions.set(session.id, { ...session });
    return { ...session };
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}
