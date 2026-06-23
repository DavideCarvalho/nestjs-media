import { Readable } from 'node:stream';
import {
  type DriverCapabilities,
  FileNotFoundError,
  type ListEntry,
  type ListOptions,
  type ListResult,
  type PutOptions,
  type StorageDriver,
  UnsupportedOperationError,
  collectStream,
} from '@dudousxd/nestjs-media-core';

export class InMemoryDriver implements StorageDriver {
  readonly capabilities: DriverCapabilities = {
    presign: false,
    multipart: false,
    publicUrls: false,
    list: true,
  };
  private readonly files = new Map<string, Buffer>();

  async put(path: string, contents: Buffer | Readable, _options?: PutOptions): Promise<void> {
    this.files.set(path, Buffer.isBuffer(contents) ? contents : await collectStream(contents));
  }

  async get(path: string): Promise<Buffer> {
    const f = this.files.get(path);
    if (!f) throw new FileNotFoundError(path);
    return f;
  }

  async stream(path: string): Promise<Readable> {
    return Readable.from(await this.get(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async size(path: string): Promise<number> {
    return (await this.get(path)).byteLength;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async copy(from: string, to: string): Promise<void> {
    this.files.set(to, await this.get(from));
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    this.files.delete(from);
  }

  async list(prefix: string, options?: ListOptions): Promise<ListResult> {
    const delimiter = options?.delimiter ?? '/';
    const folders = new Set<string>();
    const files: ListEntry[] = [];
    for (const [key, buffer] of this.files.entries()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const delimiterIndex = rest.indexOf(delimiter);
      if (delimiterIndex === -1) {
        files.push({ key, name: rest, sizeBytes: buffer.length, lastModified: null });
      } else {
        folders.add(`${prefix}${rest.slice(0, delimiterIndex + 1)}`);
      }
    }
    return { folders: Array.from(folders).sort(), files };
  }

  async url(_path: string): Promise<string> {
    throw new UnsupportedOperationError('memory', 'url');
  }

  async temporaryUrl(_path: string, _expiresInSeconds: number): Promise<string> {
    throw new UnsupportedOperationError('memory', 'temporaryUrl');
  }
}
