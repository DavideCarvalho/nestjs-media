import type { MultipartPart, UploadSession, UploadSessionStore } from '@dudousxd/nestjs-media-core';

/** In-memory UploadSessionStore for tests. */
export class InMemoryUploadSessionStore implements UploadSessionStore {
  private readonly sessions = new Map<string, UploadSession>();
  private readonly parts = new Map<string, Map<number, string>>();

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
    this.parts.delete(id);
  }

  async addPart(id: string, part: MultipartPart): Promise<void> {
    const existing = this.parts.get(id) ?? new Map<number, string>();
    existing.set(part.partNumber, part.etag);
    this.parts.set(id, existing);
  }

  async listParts(id: string): Promise<MultipartPart[]> {
    return [...(this.parts.get(id) ?? new Map<number, string>()).entries()].map(
      ([partNumber, etag]) => ({ partNumber, etag }),
    );
  }
}
